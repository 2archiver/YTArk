# YTArk release pipeline (2.2 onward)

One trusted pipeline publishes the signed ARMv7 APK. A merged PR and a green CI
run build and validate a candidate; **the same run then publishes the stable
GitHub release**. There is no tag-push chain, no mandatory approval stage and no
manual three-stage process.

```
push to main (2archiver/YTArk)
      │
      ├─ release-guard        tools/publish_release.py plan        contents: read
      │       classifies: absent | draft-match | draft-mismatch | published-complete
      │                  | published-incomplete
      │
      ├─ build-apk-candidates build + sign + package checks        contents: read
      │       uploads the ytark-armv7-candidate artefact and a
      │       candidate-manifest.json (exact paths + sha256)
      │
      └─ publish-release      needs: [release-guard, build-apk-candidates]
              contents: write, actions: read
              re-verifies the downloaded artefact, publishes the immutable
              userscript tag, stages a draft, uploads only missing assets,
              promotes to stable/non-prerelease/latest, then re-downloads every
              public asset and verifies it before printing the APK link
```

## Automatic path

Push to `main` in `2archiver/YTArk`. Nothing else is required. The publish job
only runs when:

- `github.repository == '2archiver/YTArk'` and `github.ref == 'refs/heads/main'`,
- `needs.release-guard.result == 'success'`,
- `needs.build-apk-candidates.result` is not `failure` or `cancelled`.

A failed build, a failed validation step or a failed guard can therefore never
reach publication. The build job is read-only and is the only job that reads the
signing key; the publish job holds `contents: write` and `actions: read` (the
latter only to download the artefact this run produced).

## Manual recovery path

`Actions → Publish or repair a reviewed YTArk candidate (recovery) → Run
workflow`, or:

```sh
gh workflow run publish-release.yml \
  --repo 2archiver/YTArk \
  --ref main \
  -f candidate_run_id=<successful build-apk.yml run id> \
  -f expected_head_sha=<40-character commit the candidate was built from> \
  -f device_test_notes='optional self-reported device notes'
```

`device_test_notes` is optional and is never a gate; it is echoed in the job
summary, clearly separated from the static checks.

The recovery workflow refuses the run unless it is a
`.github/workflows/build-apk.yml` run with `conclusion == success`, event
`push`/`workflow_dispatch`, `head_branch == main`, `head_sha == expected_head_sha`
and `repository.full_name == 2archiver/YTArk`, and unless the
`ytark-armv7-candidate` artefact still exists and is not expired.

## Release state machine (`tools/publish_release.py`)

| State | Action | Rebuild? |
|---|---|---|
| `absent` | create a draft at the reviewed commit, upload every asset, promote | yes |
| `draft-match` (draft carries this candidate's identity) | promote that same draft | no |
| `draft-incomplete-match` | upload the genuinely missing assets, promote | yes |
| `draft-mismatch` (staged from another candidate) | restage the unpublished draft in place (drop its staged assets, upload the verified ones, promote) | yes |
| `draft-mismatch` with a rewritten tag (`untagged-…`) | delete that draft — it can never carry the version tag — and create a new one | yes |
| `published-complete` | verify the public bytes and metadata; change nothing | no |
| `published-incomplete` | upload only the missing assets from the verified candidate | yes |
| `published-conflict` | fail with the next patch version to use; never overwrite | no |
| `published-invalid` | fail loudly (metadata/assets do not validate) | no |

Mutations are keyed by release **id**, never by tag: GitHub answers
`GET /releases/tags/{tag}` with 404 while a release is still a draft, so a
tag-keyed upload (for example `gh release upload v2.2.0 …`) cannot stage assets
on an unpublished release. This bit the 2.2 release once; it is now covered by
`test_assets_are_uploaded_by_release_id_not_by_tag`.

The git tag is created and verified **before** the release, and a release whose
tag GitHub rewrote is deleted so the next run can retry. Two failure modes made
this necessary:

- GitHub silently renames a release to `untagged-<sha>` when it cannot create
  the requested tag, which breaks the immutable version binding without any
  error. Deleting a release also deletes its tag, and recreating that tag
  seconds later is what makes GitHub fall back to the synthetic name, so a
  stale draft is now **restaged in place** instead of deleted and recreated.
- A draft that no tag lookup can find any more (because its tag was rewritten)
  is recovered by shape — the expected release name, or holding one of the
  required asset names — so an interrupted run never leaves a duplicate draft.

Rules that never change:

- A published asset that already exists is never overwritten, renamed or deleted.
- A tag is never moved. `publish_script_tag.sh` reuses an identical `sNN` tag and
  refuses one that serves different bytes.
- The published `SHA256SUMS.txt` decides whether a rebuilt APK may repair a
  published release. If the bytes disagree, the run fails and names the next
  patch version (`versionName`, `versionCode`) instead of moving a tag.
- Immutable releases: a `403`/`422` on upload is reported as such, with the next
  patch version to use — never as "release does not exist".
- A confirmed HTTP 404 means "absent". Rate limits, 5xx, network errors and
  malformed JSON are hard errors, never "absent".
- Concurrency group `ytark-release-publication`, `cancel-in-progress: false`.

## Job summaries

The publish job writes three clearly separated blocks: the build artefact (an
Actions artefact, not a release), the staged draft, and the final public release.
The public APK URL is printed only after the public download has been verified
byte-for-byte against the candidate.

## Tests

```sh
python3 -m unittest discover -s tools/tests -v      # includes test_publish_release.py
python3 tools/check_workflow_policy.py              # trust boundary + pipeline policy
```

`tools/tests/test_publish_release.py` covers every row of the state machine above
plus the non-404 API failures, using the production helper (not a re-implementation).
