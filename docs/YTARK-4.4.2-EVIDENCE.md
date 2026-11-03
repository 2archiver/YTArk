# YTArk 4.4.2 validation

This patch addresses reported invisible OLED Black/Liquid Glass settings and lag
opening playback settings. The user reports that high-quality playback and the
quality notification already work. Stream selection, codecs and buffering are
unchanged.

## Appearance evidence

The current public YouTube TV guest frontend uses obfuscated CSS classes but
retains semantic component tags. The earlier theme selectors missed these
components. The patch targets those tags and applies reversible inline styles
to known surfaces, excluding media, artwork, captions and fullscreen stages.

A fresh guest Chromium session loaded the public frontend through verified HTTPS
and injected the actual theme/config module. With both options enabled, status
reported six OLED surfaces, four glass surfaces, a computed main background of
`rgb(0, 0, 0)` and nine managed nodes. Sidebar and search treatments were visible.
No page errors were observed. This is browser evidence, not a physical Cobalt run.

Automated browser checks pass against both a minimal semantic fixture and a
captured current guest DOM with its frontend CSS. They cover normalized native
setting writes, true-black backgrounds, glass tint, transparent fullscreen
stages, repeated component cloning, bounded tracking and restoration on opt-out.

## Menu and regression evidence

- Constructor source analysis runs once across 100 control constructions.
- Reopening a reused playback menu 100 times does not accumulate custom rows.
- Menu mutations do not reconcile the quality handler; video replacement does.
- JavaScript suite: 446 tests passed, zero failed.
- Python suite: 279 tests passed, one skipped.
- Production bundle built and syntax checked; all 55 bundle-contract symbols pass.
- Workflow policy, secret scan and whitespace checks pass.

## Device acceptance still required

Physical Google TV theme coverage, blur cost and playback-menu timing remain
unverified. No measured TV speedup is claimed. Appearance status exposes the
observed main background and matched surface counts to support that check.
