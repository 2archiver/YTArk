"""Expose bounded compilation diagnostics when raw Actions logs aren't reachable."""
import pathlib
import sys


def diagnostics(names):
    # GitHub retains only ten error annotations per step. Prefer the latest
    # build stage so successful compiler warnings cannot hide a repack failure.
    remaining = 10
    for name in reversed(names):
        path = pathlib.Path(name)
        if not path.is_file():
            continue
        lines = [line for line in path.read_text(errors='replace').splitlines() if line.strip()]
        for line in lines[-remaining:]:
            safe = line.replace('%', '%25').replace('\r', '').replace('\n', '%0A')
            print(f'::error title={path.name}::{safe[:1000]}')
            remaining -= 1
        if not remaining:
            break


if __name__ == '__main__':
    diagnostics(sys.argv[1:])
