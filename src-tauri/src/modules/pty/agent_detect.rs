const ESC: u8 = 0x1b;
const BEL: u8 = 0x07;
const OSC_INTRO: u8 = b']';
const ST_FINAL: u8 = b'\\';

const OSC_MAX: usize = 2048;

const DEFAULT_AGENTS: &[&str] = &[
    "claude",
    "claudecode",
    "claude-code",
    "claude_code",
    "codex",
    "pi",
    "opencode",
    "open-code",
    "open_code",
    "agy",
    "gemini",
];

// OSC 777 marker our Claude Code hooks emit via `terminalSequence`.
const AGNI_MARKER: &[u8] = b"notify;Agni;";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum State {
    Ground,
    Esc,
    Osc,
    OscEsc,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Status {
    Working,
    Waiting,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Transition {
    Started { agent: String },
    Working,
    Attention,
    Finished,
    Exited,
}

#[derive(Clone, serde::Serialize)]
pub struct AgentSignal {
    pub id: u32,
    pub kind: &'static str,
    pub agent: Option<String>,
}

impl Transition {
    pub fn into_signal(self, id: u32) -> AgentSignal {
        match self {
            Transition::Started { agent } => AgentSignal {
                id,
                kind: "started",
                agent: Some(agent),
            },
            Transition::Working => AgentSignal {
                id,
                kind: "working",
                agent: None,
            },
            Transition::Attention => AgentSignal {
                id,
                kind: "attention",
                agent: None,
            },
            Transition::Finished => AgentSignal {
                id,
                kind: "finished",
                agent: None,
            },
            Transition::Exited => AgentSignal {
                id,
                kind: "exited",
                agent: None,
            },
        }
    }
}

pub struct AgentDetector {
    agents: Vec<String>,
    state: State,
    osc: Vec<u8>,
    armed: bool,
    status: Status,
}

impl AgentDetector {
    pub fn new() -> Self {
        Self::with_agents(DEFAULT_AGENTS.iter().map(|s| s.to_string()).collect())
    }

    pub fn with_agents(agents: Vec<String>) -> Self {
        Self {
            agents,
            state: State::Ground,
            osc: Vec::new(),
            armed: false,
            status: Status::Working,
        }
    }

    pub fn process<F: FnMut(Transition)>(&mut self, input: &[u8], mut emit: F) {
        if self.state == State::Ground && !input.contains(&ESC) {
            return;
        }
        for &b in input {
            match self.state {
                State::Ground => {
                    if b == ESC {
                        self.state = State::Esc;
                    }
                }
                State::Esc => match b {
                    OSC_INTRO => {
                        self.state = State::Osc;
                        self.osc.clear();
                    }
                    ESC => {}
                    _ => self.state = State::Ground,
                },
                State::Osc => match b {
                    BEL => {
                        self.finish_osc(&mut emit);
                        self.state = State::Ground;
                    }
                    ESC => self.state = State::OscEsc,
                    _ => {
                        if self.osc.len() < OSC_MAX {
                            self.osc.push(b);
                        } else {
                            self.osc.clear();
                            self.state = State::Ground;
                        }
                    }
                },
                State::OscEsc => match b {
                    ST_FINAL => {
                        self.finish_osc(&mut emit);
                        self.state = State::Ground;
                    }
                    ESC => {}
                    _ => {
                        self.osc.clear();
                        self.state = State::Ground;
                    }
                },
            }
        }
    }

    pub fn finish<F: FnMut(Transition)>(&mut self, mut emit: F) {
        if self.armed {
            self.disarm();
            emit(Transition::Exited);
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
        self.status = Status::Working;
    }

    fn finish_osc<F: FnMut(Transition)>(&mut self, emit: &mut F) {
        let body = std::mem::take(&mut self.osc);
        let (ps, pt) = match body.iter().position(|&c| c == b';') {
            Some(i) => (&body[..i], &body[i + 1..]),
            None => (&body[..], &body[0..0]),
        };
        match ps {
            b"133" => self.handle_osc133(pt, emit),
            b"9" if !pt.starts_with(b"4;") && pt != b"4" => self.generic_attention(emit),
            b"777" => self.handle_osc777(pt, emit),
            _ => {}
        }
    }

    fn handle_osc777<F: FnMut(Transition)>(&mut self, pt: &[u8], emit: &mut F) {
        if let Some(event) = pt.strip_prefix(AGNI_MARKER) {
            match event {
                b"working" => {
                    self.ensure_armed(emit);
                    self.set_working(emit);
                }
                b"attention" => {
                    self.ensure_armed(emit);
                    self.status = Status::Waiting;
                    emit(Transition::Attention);
                }
                b"finished" => {
                    self.ensure_armed(emit);
                    self.status = Status::Waiting;
                    emit(Transition::Finished);
                }
                _ => {}
            }
            return;
        }
        self.generic_attention(emit);
    }

    fn handle_osc133<F: FnMut(Transition)>(&mut self, pt: &[u8], emit: &mut F) {
        match pt.first() {
            Some(b'C') => {
                if self.armed {
                    return;
                }
                let cmd = pt.strip_prefix(b"C;").unwrap_or(b"");
                if let Some(agent) = self.match_agent(cmd) {
                    self.armed = true;
                    self.status = Status::Working;
                    emit(Transition::Started { agent });
                }
            }
            Some(b'D') if self.armed => {
                self.disarm();
                emit(Transition::Exited);
            }
            _ => {}
        }
    }

    fn ensure_armed<F: FnMut(Transition)>(&mut self, emit: &mut F) {
        if !self.armed {
            self.armed = true;
            self.status = Status::Working;
            emit(Transition::Started {
                agent: "claude".into(),
            });
        }
    }

    fn set_working<F: FnMut(Transition)>(&mut self, emit: &mut F) {
        if self.status != Status::Working {
            self.status = Status::Working;
            emit(Transition::Working);
        }
    }

    fn generic_attention<F: FnMut(Transition)>(&mut self, emit: &mut F) {
        if self.armed {
            self.status = Status::Waiting;
            emit(Transition::Attention);
        }
    }

    fn match_agent(&self, cmd: &[u8]) -> Option<String> {
        let cmd = std::str::from_utf8(cmd).ok()?;
        for token in cmd.split_whitespace() {
            if token.starts_with('-') {
                continue;
            }
            let base = token.rsplit(['/', '\\']).next().unwrap_or(token);
            let base = strip_windows_command_suffix(base);
            let base = base.to_ascii_lowercase();
            if let Some(agent) = self.agents.iter().find(|a| {
                base.strip_prefix(a.as_str())
                    .is_some_and(|r| r.is_empty() || r.starts_with('-'))
            }) {
                return Some(canonical_agent(agent).to_string());
            }
        }
        None
    }
}

fn strip_windows_command_suffix(base: &str) -> &str {
    for suffix in [".exe", ".cmd", ".bat", ".ps1"] {
        if base
            .get(base.len().saturating_sub(suffix.len())..)
            .is_some_and(|tail| tail.eq_ignore_ascii_case(suffix))
        {
            return &base[..base.len() - suffix.len()];
        }
    }
    base
}

fn canonical_agent(agent: &str) -> &str {
    match agent {
        "claudecode" | "claude-code" | "claude_code" => "claude",
        "open-code" | "open_code" => "opencode",
        _ => agent,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detect(cmd: &str) -> Option<String> {
        AgentDetector::new().match_agent(cmd.as_bytes())
    }

    #[test]
    fn matches_common_agent_commands() {
        for (cmd, expected) in [
            ("pi", "pi"),
            ("gemini", "gemini"),
            ("opencode", "opencode"),
            ("claude", "claude"),
            ("claudecode", "claude"),
        ] {
            assert_eq!(detect(cmd).as_deref(), Some(expected));
        }
    }

    #[test]
    fn matches_windows_command_shims() {
        assert_eq!(detect("opencode.cmd").as_deref(), Some("opencode"));
        assert_eq!(detect("gemini.exe").as_deref(), Some("gemini"));
        assert_eq!(detect("claudecode.ps1").as_deref(), Some("claude"));
    }

    #[test]
    fn scans_launcher_arguments_for_agent_name() {
        assert_eq!(detect("pnpm dlx opencode").as_deref(), Some("opencode"));
    }

    #[test]
    fn osc_command_start_emits_started_signal() {
        let mut detector = AgentDetector::new();
        let mut transitions = Vec::new();

        detector.process(b"\x1b]133;C;Gemini.exe\x1b\\", |t| transitions.push(t));

        assert_eq!(
            transitions,
            vec![Transition::Started {
                agent: "gemini".into()
            }]
        );
    }
}
