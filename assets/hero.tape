# hero.tape — Records the hero GIF for the README
# Shows: boot animation, list view, navigation, pane view, log pane, timeline
#
# Prerequisites: run `scripts/mock-sessions.sh` first to spawn fake sessions
# Usage: vhs assets/hero.tape

Output assets/hero.gif
Set Theme "Catppuccin Mocha"
Set FontFamily "JetBrains Mono"
Set FontSize 13
Set Width 1400
Set Height 700
Set Padding 16
Set Framerate 15
Set PlaybackSpeed 1

# Launch ctop — boot animation plays automatically
Type "./claude-manager"
Enter
Sleep 4s

# Navigate through sessions
Sleep 1s
Type "j"
Sleep 600ms
Type "j"
Sleep 600ms
Type "j"
Sleep 1.5s

# Back to top
Type "g"
Sleep 1s

# Switch to pane view
Type "P"
Sleep 2.5s

# Toggle log pane
Type "L"
Sleep 2.5s

# Close log pane
Type "L"
Sleep 500ms

# Show timeline
Type "W"
Sleep 3s

# Exit timeline
Type "q"
Sleep 500ms

# Back to list view
Type "P"
Sleep 2s

# Quit
Type "q"
Sleep 500ms
