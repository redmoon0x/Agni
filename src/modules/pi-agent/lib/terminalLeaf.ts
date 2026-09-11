// Sentinel leaf id for the Pi panel's single terminal pane. The terminal
// dock allocates leaf ids from 1 upward, so a negative id can never collide
// with it -- both share the same module-level session map in useTerminalSession.
export const PI_TERMINAL_LEAF_ID = -1;
