# agni-shell-integration (zprofile)
#
# See zshenv.zsh for the rationale on the trailing `:`.
{
  _agni_user_zdotdir="${AGNI_USER_ZDOTDIR:-$HOME}"
  [ -f "$_agni_user_zdotdir/.zprofile" ] && source "$_agni_user_zdotdir/.zprofile"
  unset _agni_user_zdotdir
}
:
