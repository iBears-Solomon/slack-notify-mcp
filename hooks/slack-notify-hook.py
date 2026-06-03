#!/usr/bin/env python3
"""Claude Code hook -> Slack notification.

Fires on Claude Code lifecycle events, reads the bot token + channel from
the slack-notify MCP entry in ~/.claude.json (so configuration stays in
one place), resolves the session's display title, and posts a two-line
status to Slack with a click-through link that opens Claude Code at the
project.

Registered events (settings.json): `Stop` + `Notification`.
  - Stop: normal turn end -> "已解決" / "待回覆" (when the turn ends on a
    trailing ?/？).
  - Notification: the ONLY hook that fires when Claude pauses on an
    interactive tool. AskUserQuestion / ExitPlanMode end the turn with
    stop_reason=tool_use, so Stop never fires for them; Notification is how
    we catch "plan ready for approval" and "options shown". To avoid spam we
    notify on Notification ONLY when a pending question/plan is detected --
    permission prompts and plain 60s idle are ignored.
`SessionEnd` is also handled if you wire it up, but is off by default: it
fires on every session close (including stale tabs) and auto-titles collide,
making "已結束" ambiguous.

Cross-event dedupe (see tail_signature): Stop and Notification can both fire
for the same pause; a per-session state file keyed on the last assistant
message uuid collapses them into a single notification.

Title resolution (see resolve_title): the Claude Desktop app's live title
(what the sidebar shows / the rename dialog edits) is preferred, because
the transcript's ai-title is an early auto-generated label that is frozen
once written and does NOT track renames. Falls back to the transcript
ai-title on CLI / Linux, then to "Untitled".

Message format
--------------
    已解決: <user's last prompt>                   (Stop, Claude finished)
    待回覆: <Claude's pending question>            (Stop, Claude is asking)
    已結束                                          (SessionEnd)
    by <claude://...|project/session-title>

Subagent stops are never notified -- this hook is only registered on the
main-agent `Stop` event in settings.json, and as a belt-and-suspenders
check we also bail out if the transcript path contains `/subagents/`.

Empty/trivial sessions are silenced. A session that never earned an
ai-title had no real conversation, so SessionEnd is skipped entirely for
it (this kills the "已結束 by solomon/Untitled" noise from throwaway
home-dir shells). Stop is likewise skipped when there is neither an
extractable user prompt nor a title -- nothing worth reporting.

Behaviour summary
-----------------
- Stop event is content-aware:
    * If the last assistant message used `AskUserQuestion` OR its last text
      line ends with `?` / `？`, body becomes `待回覆: <question>`.
    * Otherwise body becomes `已解決: <user's last prompt>`, which is
      generally a better topic indicator than Claude's last sentence.
- Stop event is also deduplicated: if the assistant already invoked
  mcp__slack-notify__send_message in the current turn, we skip the
  auto-notification to avoid back-to-back messages.
- Failure surface: write to ~/.claude/scripts/slack-notify-hook.log only,
  and ALWAYS exit 0. Surfacing errors via exit 2 + stderr would block the
  Stop event and create an infinite loop (Claude continues -> finishes ->
  Stop fires -> fails again -> blocks again). See fail() for the full
  reasoning.

Timestamps in the log follow the common--get-timestamp skill convention
(ISO 8601 with timezone). The user-visible message itself contains no
timestamp -- Slack already shows the time next to every message.

Invoked from settings.json like:
    python3 ~/.claude/scripts/slack-notify-hook.py Stop
"""

import json
import os
import re
import subprocess
import sys
import urllib.parse
from datetime import datetime
from pathlib import Path

# Which mcpServers entry in ~/.claude.json supplies token + channel.
INSTANCE = "slack-notify"

LOG_PATH = Path.home() / ".claude" / "scripts" / "slack-notify-hook.log"

# Claude Desktop keeps per-session metadata (including the user-visible /
# renamed title) here, separate from the CLI transcript. macOS-desktop-only;
# absent on CLI / Linux, where we fall back to the transcript's ai-title.
DESKTOP_SESSIONS_DIR = (
    Path.home()
    / "Library"
    / "Application Support"
    / "Claude"
    / "claude-code-sessions"
)

SLACK_NOTIFY_TOOL = "mcp__slack-notify__send_message"
ASK_USER_TOOL = "AskUserQuestion"
EXIT_PLAN_TOOL = "ExitPlanMode"

# Cross-event dedupe state: maps session_id -> last-notified tail signature,
# so the same pause is not announced twice (e.g. Stop already sent, then an
# idle Notification fires for the same turn; or Notification fires repeatedly
# for one pending question).
STATE_PATH = Path.home() / ".claude" / "scripts" / "slack-notify-hook.state.json"

# Maximum characters for the user-visible body before truncation.
BODY_MAX = 120


# ---------------------------------------------------------------------------
# logging / failure handling
# ---------------------------------------------------------------------------


def log(msg: str) -> None:
    """Append a timestamped line to the hook log (best-effort)."""
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().astimezone().strftime("%Y-%m-%dT%H:%M:%S%z")
        with LOG_PATH.open("a") as f:
            f.write(f"{ts} {msg}\n")
    except Exception:
        pass


def fail(reason: str) -> None:
    """Record a failure to the log file and exit cleanly.

    CRITICAL: this MUST exit 0, never non-zero -- especially never 2.

    Claude Code interprets a Stop hook returning exit 2 with stderr as a
    blocking signal: "do not stop, Claude must continue with this feedback".
    Claude continues -> finishes again -> Stop fires again -> if the
    underlying problem persists (token expired, network down, channel gone)
    it fails again -> blocks again. Infinite loop.

    So failures are recorded to the log only. To see them, tail
    ~/.claude/scripts/slack-notify-hook.log. A separate SessionStart hook
    could surface recent failures at next session start if needed.
    """
    log(f"FAIL {reason}")
    sys.exit(0)


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------


def truncate(s: str, n: int = BODY_MAX) -> str:
    s = s.strip()
    if len(s) <= n:
        return s
    return s[:n].rstrip() + "…"


def escape_for_slack(s: str) -> str:
    """Slack mrkdwn-safe escape for display text inside <url|text>."""
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def clean_user_text(text: str) -> str:
    """Make a user message presentable.

    Slash-command invocations arrive wrapped like
        <command-message>...</command-message>
        <command-name>/foo</command-name>
        <command-args>bar baz</command-args>
        ...body...
    Pull out command-name + command-args if present. Otherwise return the
    first non-empty, non-XML line.
    """
    if "<command-name>" in text and "<command-args>" in text:
        n = re.search(r"<command-name>([^<]+)</command-name>", text)
        a = re.search(r"<command-args>([^<]*)</command-args>", text)
        if n:
            parts = [n.group(1).strip()]
            if a and a.group(1).strip():
                parts.append(a.group(1).strip())
            return " ".join(parts)
    for line in text.splitlines():
        line = line.strip()
        if line and not line.startswith("<"):
            return line
    return text.strip()


# ---------------------------------------------------------------------------
# transcript readers
# ---------------------------------------------------------------------------


def read_title(transcript_path: str) -> str:
    """Return the most recent aiTitle from the transcript JSONL."""
    title = "Untitled"
    try:
        with open(transcript_path) as f:
            for line in f:
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                if obj.get("type") == "ai-title" and obj.get("aiTitle"):
                    title = obj["aiTitle"]
    except Exception:
        pass
    return title


def read_desktop_title(session_id: str) -> str:
    """Return the Claude Desktop display title for this session, or "".

    The transcript's ai-title is an early auto-generated label that does NOT
    track renames -- once written it is frozen. The Claude Desktop app keeps
    the live, user-visible title (what the sidebar shows and what the rename
    dialog edits) in a separate per-session metadata file:
        ~/Library/Application Support/Claude/claude-code-sessions/
            **/local_*.json
    each carrying cliSessionId (== transcript session id) and title. We
    prefer that title so Slack matches what the user actually sees.

    Returns "" when the dir is absent (CLI / Linux) or no match is found,
    so callers can fall back to the transcript ai-title.
    """
    if not session_id:
        return ""
    try:
        if not DESKTOP_SESSIONS_DIR.is_dir():
            return ""
        for f in DESKTOP_SESSIONS_DIR.rglob("local_*.json"):
            try:
                txt = f.read_text()
            except Exception:
                continue
            # Cheap prefilter before the full JSON parse.
            if session_id not in txt:
                continue
            try:
                d = json.loads(txt)
            except Exception:
                continue
            if d.get("cliSessionId") == session_id:
                return (d.get("title") or "").strip()
    except Exception:
        pass
    return ""


def resolve_title(session_id: str, transcript_path: str) -> str:
    """Best available session title: desktop (live) > transcript > Untitled."""
    title = read_desktop_title(session_id)
    if not title and transcript_path:
        title = read_title(transcript_path)
    return title or "Untitled"


def used_slack_notify_this_turn(transcript_path: str) -> bool:
    """Scan transcript from end; True iff the assistant invoked the
    slack-notify tool before reaching the previous real user message.
    """
    try:
        with open(transcript_path) as f:
            lines = f.readlines()
    except Exception:
        return False

    for raw in reversed(lines):
        try:
            obj = json.loads(raw)
        except Exception:
            continue

        t = obj.get("type")

        if t == "user":
            content = obj.get("message", {}).get("content")
            if isinstance(content, str):
                return False
            if isinstance(content, list) and any(
                not isinstance(c, dict) or c.get("type") != "tool_result"
                for c in content
            ):
                return False

        if t == "assistant":
            content = obj.get("message", {}).get("content", [])
            if isinstance(content, list):
                for c in content:
                    if (
                        isinstance(c, dict)
                        and c.get("type") == "tool_use"
                        and c.get("name") == SLACK_NOTIFY_TOOL
                    ):
                        return True
    return False


def find_last_user_text(transcript_path: str) -> str:
    """Return cleaned text of the most recent real user message."""
    try:
        with open(transcript_path) as f:
            lines = f.readlines()
    except Exception:
        return ""

    for raw in reversed(lines):
        try:
            obj = json.loads(raw)
        except Exception:
            continue
        if obj.get("type") != "user":
            continue

        content = obj.get("message", {}).get("content")
        if isinstance(content, str):
            return clean_user_text(content)

        if isinstance(content, list):
            text_parts = []
            real = False
            for c in content:
                if not isinstance(c, dict):
                    real = True
                    continue
                ct = c.get("type")
                if ct == "text":
                    text_parts.append(c.get("text", ""))
                    real = True
                elif ct != "tool_result":
                    real = True
            if real:
                combined = "\n".join(t for t in text_parts if t).strip()
                return clean_user_text(combined) if combined else ""
            # Only tool_results -> keep scanning past it.
    return ""


def find_last_assistant_question(transcript_path: str) -> str:
    """If the last assistant message is awaiting the user, return a topic.

    These are the cases where Claude paused for the user. The turn ends with
    `stop_reason: tool_use`, so the Stop hook does NOT fire for (1) and (2) --
    they are caught via the Notification hook instead.

    Checked in order:
      1. `AskUserQuestion` tool use -> first question's text.
      2. `ExitPlanMode` tool use (plan ready for approval) -> fixed label.
      3. The last text line ends with `?` or `？` -> that line.
    Else return "".
    """
    try:
        with open(transcript_path) as f:
            lines = f.readlines()
    except Exception:
        return ""

    for raw in reversed(lines):
        try:
            obj = json.loads(raw)
        except Exception:
            continue
        if obj.get("type") != "assistant":
            continue

        content = obj.get("message", {}).get("content", [])
        if not isinstance(content, list):
            return ""

        # 1./2. Interactive tool use that pauses for the user.
        for c in content:
            if not (isinstance(c, dict) and c.get("type") == "tool_use"):
                continue
            name = c.get("name")
            if name == ASK_USER_TOOL:
                qs = c.get("input", {}).get("questions", [])
                if qs and isinstance(qs[0], dict):
                    q = qs[0].get("question", "")
                    if q:
                        return q
            elif name == EXIT_PLAN_TOOL:
                return "計劃已就緒,待你核准"

        # 3. Last text line ends with a question mark.
        texts = [
            c.get("text", "")
            for c in content
            if isinstance(c, dict) and c.get("type") == "text"
        ]
        if texts:
            combined = "\n".join(texts).strip()
            last_line = combined.rsplit("\n", 1)[-1].strip()
            if last_line and last_line.endswith(("?", "？")):
                return last_line

        return ""  # found assistant message but not waiting
    return ""


# ---------------------------------------------------------------------------
# cross-event dedupe (state file)
# ---------------------------------------------------------------------------


def tail_signature(transcript_path: str) -> str:
    """Signature of the current turn tail = last assistant message's uuid.

    Stop and Notification can both fire for the same pause (e.g. Stop ends a
    turn, then 60s idle fires Notification); and Notification can fire more
    than once for one pending question. Keying dedupe on the last assistant
    message's uuid collapses all of those to a single notification.
    Returns "" if no uuid is found (then we do NOT dedupe -- better to risk a
    rare dup than to over-suppress).
    """
    try:
        with open(transcript_path) as f:
            lines = f.readlines()
    except Exception:
        return ""
    for raw in reversed(lines):
        try:
            obj = json.loads(raw)
        except Exception:
            continue
        if obj.get("type") == "assistant":
            return obj.get("uuid") or obj.get("message", {}).get("id") or ""
    return ""


def _load_state() -> dict:
    try:
        return json.loads(STATE_PATH.read_text())
    except Exception:
        return {}


def already_notified(session_id: str, sig: str) -> bool:
    if not (session_id and sig):
        return False
    return _load_state().get(session_id) == sig


def mark_notified(session_id: str, sig: str) -> None:
    if not (session_id and sig):
        return
    st = _load_state()
    st[session_id] = sig
    # Bound the file: keep the most recently inserted ~150 sessions.
    if len(st) > 300:
        st = dict(list(st.items())[-150:])
    try:
        STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        STATE_PATH.write_text(json.dumps(st))
    except Exception:
        pass


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def main() -> None:
    event = sys.argv[1] if len(sys.argv) > 1 else "Unknown"

    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except Exception:
        payload = {}

    cwd = payload.get("cwd") or os.getcwd()
    transcript_path = payload.get("transcript_path", "") or ""
    project = Path(cwd).name or "claude-code"

    # Session id: from the hook payload, else derived from the transcript
    # filename (<session_id>.jsonl). Used to look up the desktop title.
    session_id = payload.get("session_id") or ""
    if not session_id and transcript_path:
        session_id = Path(transcript_path).stem

    # Safety: never fire for subagent transcripts. We only register Stop on
    # the main agent, but if Claude Code ever changes that and feeds Stop
    # for subagents too, this keeps us silent.
    if "/subagents/" in transcript_path:
        log(f"SKIP {event} (subagent transcript)")
        sys.exit(0)

    # Stop dedupe.
    if (
        event == "Stop"
        and transcript_path
        and used_slack_notify_this_turn(transcript_path)
    ):
        log(f"SKIP Stop (slack-notify already used this turn) cwd={cwd}")
        sys.exit(0)

    title = resolve_title(session_id, transcript_path)
    has_title = title != "Untitled"

    # Build the body. Bail out (no notification) when there is nothing
    # meaningful to report -- otherwise we spam Slack with empty status
    # lines like "已結束 by solomon/Untitled" from throwaway home-dir shells.
    if event == "SessionEnd":
        # A session that never earned an ai-title had no substantive
        # conversation; announcing its end carries zero information. Skip.
        if not has_title:
            log(f"SKIP SessionEnd (no title, trivial session) cwd={cwd}")
            sys.exit(0)
        body = "已結束"
    elif event == "Notification":
        # Notification fires for permission prompts, 60s idle, and -- in
        # practice -- when Claude is blocked on an interactive tool. The Stop
        # hook does NOT fire for AskUserQuestion / ExitPlanMode (the turn ends
        # with stop_reason=tool_use), so Notification is the ONLY way to catch
        # them. We notify ONLY when a pending question/plan is detected:
        #   - skips permission prompts (too frequent -> would spam), and
        #   - skips plain idle after a normal turn (Stop already sent 已解決).
        pending = (
            find_last_assistant_question(transcript_path)
            if transcript_path
            else ""
        )
        if not pending:
            log(f"SKIP Notification (no pending question/plan) cwd={cwd}")
            sys.exit(0)
        body = f"待回覆: {truncate(pending)}"
    else:  # Stop (and any unknown event)
        question = (
            find_last_assistant_question(transcript_path)
            if transcript_path
            else ""
        )
        if question:
            body = f"待回覆: {truncate(question)}"
        else:
            user_text = (
                find_last_user_text(transcript_path) if transcript_path else ""
            )
            if user_text:
                body = f"已解決: {truncate(user_text)}"
            elif has_title:
                # No extractable prompt, but we do have a topic -- use it.
                body = f"已解決: {truncate(title)}"
            else:
                # Nothing to report: no prompt, no title. Skip rather than
                # send a bare "已解決" that says nothing.
                log(f"SKIP Stop (no user text, no title) cwd={cwd}")
                sys.exit(0)

    # Cross-event dedupe: collapse Stop + Notification (and repeated
    # Notifications) for the same turn tail into one message.
    sig = tail_signature(transcript_path) if transcript_path else ""
    if already_notified(session_id, sig):
        log(f"SKIP {event} (already notified this tail sig={sig[:8]}) cwd={cwd}")
        sys.exit(0)

    # Slack mrkdwn link: <url|display-text>. Display text needs & < > escaped;
    # we also keep `|` away from the display text since it terminates the URL.
    cwd_url = urllib.parse.quote(cwd, safe="/")
    label = escape_for_slack(f"{project}/{title}").replace("|", "/")
    body_safe = escape_for_slack(body)
    text = f"{body_safe}\nby <claude://code/new?folder={cwd_url}|{label}>"

    # Resolve credentials.
    try:
        cfg = json.loads((Path.home() / ".claude.json").read_text())
        env = cfg["mcpServers"][INSTANCE]["env"]
        token = env["SLACK_BOT_TOKEN"]
        channel = env["SLACK_CHANNEL_ID"]
    except Exception as e:
        fail(f"cannot read slack-notify config from ~/.claude.json: {e}")

    # Use curl rather than urllib.request: macOS system Python 3 often has no
    # cert bundle wired up, so urlopen fails with CERTIFICATE_VERIFY_FAILED.
    # curl is universally available on macOS and uses the system trust store.
    body_json = json.dumps({"channel": channel, "text": text})
    try:
        result = subprocess.run(
            [
                "curl", "-sS", "-X", "POST",
                "--max-time", "5",
                "https://slack.com/api/chat.postMessage",
                "-H", f"Authorization: Bearer {token}",
                "-H", "Content-Type: application/json; charset=utf-8",
                "-d", body_json,
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except Exception as e:
        fail(f"curl invocation failed: {e}")

    if result.returncode != 0:
        fail(f"curl exit {result.returncode}: {result.stderr.strip()[:200]}")

    try:
        data = json.loads(result.stdout)
    except Exception:
        fail(f"slack response not JSON: {result.stdout[:200]}")

    if not data.get("ok"):
        fail(f"slack api error: {data.get('error', 'unknown')}")

    mark_notified(session_id, sig)
    log(f"OK {event} -> {channel} ts={data.get('ts')} title={title!r}")


if __name__ == "__main__":
    # Belt-and-suspenders: catch anything main() didn't, log it, exit 0.
    # Python's default exit code on uncaught exception is 1, and while
    # exit 1 isn't documented as blocking Stop the way exit 2 is, leaving
    # ANY non-zero path alive is asking for a future bug. Exit 0 always.
    try:
        main()
    except SystemExit:
        raise
    except BaseException as e:
        log(f"FAIL unhandled: {type(e).__name__}: {e}")
        sys.exit(0)
