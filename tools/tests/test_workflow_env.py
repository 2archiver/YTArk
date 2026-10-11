"""Guard against reading $GITHUB_ENV entries before Actions exports them.

GitHub Actions loads GITHUB_ENV into the environment of the *next* step only.
Writing it and reading its values in the same run block broke the 2.2 candidate
build immediately after the merge; publishing had the same latent issue.
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"


def steps(path):
    """Return (name, source) for each workflow step, without YAML dependencies."""
    text = path.read_text(encoding="utf-8")
    starts = list(re.finditer(r"^      - name: (.+)$", text, re.M))
    return [(match.group(1), text[match.start():starts[index + 1].start()
                                  if index + 1 < len(starts) else len(text)])
            for index, match in enumerate(starts)]


class WorkflowEnvTests(unittest.TestCase):
    def test_candidate_binds_url_after_version_is_exported(self):
        candidate = steps(WORKFLOWS / "build-apk.yml")
        names = [name for name, _ in candidate]
        load = names.index("Load release version")
        bind = names.index("Bind the APK to the immutable userscript URL (no tag is created here)")
        self.assertLess(load, bind)
        self.assertIn('emit-env --file "$GITHUB_ENV"', candidate[load][1])
        self.assertNotIn('emit-env --file "$GITHUB_ENV"', candidate[bind][1])
        self.assertIn('SCRIPT_URL=$script_url', candidate[bind][1])
        self.assertIn('script_url="https://cdn.jsdelivr.net/gh/${GITHUB_REPOSITORY}@${SCRIPT_TAG}/userScript.js?v="', candidate[bind][1])

    def test_promotion_reads_version_only_in_following_step(self):
        publish = steps(WORKFLOWS / "publish-release.yml")
        names = [name for name, _ in publish]
        index = names.index("Re-verify the draft")
        self.assertEqual(names[index - 1], "Load release version")
        self.assertIn('emit-env --file "$GITHUB_ENV"', publish[index - 1][1])
        self.assertNotIn('emit-env --file "$GITHUB_ENV"', publish[index][1])
        self.assertIn('"$VERSION_TAG"', publish[index][1])


if __name__ == "__main__":
    unittest.main()
