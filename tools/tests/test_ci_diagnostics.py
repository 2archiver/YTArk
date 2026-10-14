"""A successful compiler log must not consume the failed repack's annotations."""
import contextlib
import io
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ci_diagnostics import diagnostics


class DiagnosticsTests(unittest.TestCase):
    def test_latest_stage_gets_annotation_budget(self):
        with tempfile.TemporaryDirectory() as directory:
            compiler = Path(directory) / 'compiler.log'
            repack = Path(directory) / 'repack.log'
            compiler.write_text('warning\n' * 15 + 'Compilation passed\n')
            repack.write_text('detail\n' * 15 + 'Repack failed: 100%\n')
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                diagnostics([compiler, repack])
            lines = output.getvalue().splitlines()
            self.assertEqual(len(lines), 10)
            self.assertTrue(all('title=repack.log' in line for line in lines))
            self.assertIn('Repack failed: 100%25', lines[-1])

    def test_missing_and_empty_later_logs_fall_back(self):
        with tempfile.TemporaryDirectory() as directory:
            compiler = Path(directory) / 'compiler.log'
            empty = Path(directory) / 'empty.log'
            compiler.write_text('Compilation failed\n')
            empty.write_text('\n')
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                diagnostics([compiler, empty, Path(directory) / 'missing.log'])
            self.assertEqual(output.getvalue(), '::error title=compiler.log::Compilation failed\n')
