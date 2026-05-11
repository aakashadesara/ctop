# features.tape — Records the features GIF for the README
# Shows: dashboard, filter, theme cycling, help overlay
#
# Prerequisites: run `scripts/mock-sessions.sh` first to spawn fake sessions
# Usage: vhs assets/features.tape

Output assets/features.gif
Set Theme "Catppuccin Mocha"
Set FontFamily "Menlo"
Set FontSize 13
Set Width 1400
Set Height 700
Set Padding 16
Set Framerate 15
Set PlaybackSpeed 1

# Launch ctop (skip boot animation for this GIF)
Type "./claude-manager --no-animation"
Enter
Sleep 2s

# Toggle dashboard
Type "d"
Sleep 2s

# Open filter
Type "/"
Sleep 500ms
Type "opus"
Sleep 1.5s

# Clear filter
Escape
Sleep 1s

# Cycle theme: default -> minimal -> dracula
Type "T"
Sleep 1.5s
Type "T"
Sleep 1.5s

# Back to default
Type "T"
Sleep 500ms
Type "T"
Sleep 500ms
Type "T"
Sleep 1s

# Show help
Type "?"
Sleep 3s

# Dismiss help
Escape
Sleep 1s

# Quit
Type "q"
Sleep 500ms
