# YTArk launcher artwork

`branding/ytark-launcher-source.png` is the exact image supplied for 4.2.
SHA-256: `de815a58125d65b5e0dd8faab7e80cbeaa9d9a06025575b72968dd0884db4e28`.
Its pixels, gradients, proportions and transparency are preserved. The obsolete
vector approximation has been removed.

Install `python3 -m pip install -r tools/requirements-branding.txt` and run
`python3 tools/render_launcher_art.py --write`. CI uses `--check` to verify
source integrity and every generated resource.

The original source and packaged full-resolution image must match byte for
byte. Resized PNGs must match dimensions, color mode and decoded pixels;
lossless PNG compression may differ between Windows and Linux Pillow wheels.

- Legacy icons: Lanczos downsampling to Android's 48–192 px mipmap sizes.
- Adaptive icon (Google TV long-press/app info): original PNG centered in a
  62dp foreground on the 108dp layer with a white background. The artwork's
  visible tile stays inside the central safe circle, preventing mask clipping.
- TV banner: 640x360 raster for the 320x180dp launcher slot, with the same
  image and YTArk lettering. No external font dependency.
- The separate `ytark_launcher_monochrome.xml` remains a simplified themed
  icon for Android 13+; full-color surfaces always use the supplied image.

`tools/repack_apk.py` installs all referenced assets and sets application,
activity, banner and round-icon references. Google TV may cache launcher
artwork; visual behavior on a physical TV remains unverified.

YTArk is an independent, unofficial project. The artwork must not imply
Google or YouTube endorsement; keep the product label `YTArk`.
