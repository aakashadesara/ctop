class CtopClaude < Formula
  desc "Terminal UI for monitoring and managing Claude Code sessions"
  homepage "https://github.com/aakashadesara/ctop"
  url "https://registry.npmjs.org/ctop-claude/-/ctop-claude-1.0.0.tgz"
  # sha256 will need to be updated when publishing
  license "MIT"

  depends_on "node@18"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    # Just verify the binary exists and shows help
    assert_match "ctop", shell_output("#{bin}/ctop --help")
  end
end
