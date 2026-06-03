# agni-shell-integration (fish)
# Emits OSC 7 (cwd) + OSC 133 A/B/C/D so the host tracks cwd and prompt
# boundaries without re-parsing the prompt.

if set -q __AGNI_HOOKS_LOADED
    exit 0
end
set -g __AGNI_HOOKS_LOADED 1

set -g __AGNI_HOST (uname -n 2>/dev/null; or echo localhost)

# URL-encode a path keeping `/` intact so it stays valid inside file://.
function __agni_urlencode_path
    set -l parts (string split '/' -- $argv[1])
    set -l out
    for p in $parts
        if test -n "$p"
            set out $out (string escape --style=url -- $p)
        else
            set out $out ""
        end
    end
    string join '/' $out
end

function __agni_restore_status
    return $argv[1]
end

if functions -q fish_prompt
    functions -c fish_prompt __agni_user_prompt
end

function fish_prompt
    set -l __agni_status $status
    printf '\e]133;D;%d\e\\' $__agni_status
    printf '\e]7;file://%s%s\e\\' "$__AGNI_HOST" (__agni_urlencode_path "$PWD")
    printf '\e]133;A\e\\'
    __agni_restore_status $__agni_status
    if functions -q __agni_user_prompt
        __agni_user_prompt
    else
        printf '%s > ' (prompt_pwd)
    end
    printf '\e]133;B\e\\'
end

function __agni_preexec --on-event fish_preexec
    set -l cmd (string replace -ra '[\x00-\x1f\x7f]' ' ' -- "$argv")
    printf '\e]133;C;%s\e\\' (string sub -l 256 -- "$cmd")
end
