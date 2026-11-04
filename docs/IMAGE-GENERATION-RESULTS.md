# Image-generation identity and realism: implementation results

## Objective and limits

The target is to let a user request a new scene or outfit in chat while keeping
the assistant's face and body recognizable, with realistic image quality.
These changes make identity conditioning and candidate evaluation more
reliable. They do **not** establish parity with ChatGPT or Grok: that requires
controlled evaluation of actual generated images with the user's local Forge
models and hardware.

## Changes made

### Identity conditioning and provider selection

- Self-portrait generation now requires a usable visual reference and a real
  FaceID-capable Forge setup. A generic IP-Adapter is no longer treated as
  FaceID; FaceID Plus v2 also requires its LoRA.
- Requests that require FaceID stop with an actionable error if the reference
  or supported conditioning is unavailable. They do not silently fall back to
  text-only providers and present a different face as the assistant.
- FaceID is applied per Forge request with `batch_size=1`; additional seeds are
  generated sequentially. The canonical avatar remains the primary reference.

### Candidate ranking and truthful feedback

- Candidate files use distinct temporary paths, and ArcFace evaluates a batch
  after one scorer initialization. The ranker accepts only the expected ArcFace
  result; it does not substitute color histograms or another proxy.
- The scorer uses local InsightFace/ONNX/OpenCV/NumPy dependencies and the
  locally installed `buffalo_l` model. It does not automatically download the
  model or send image data elsewhere.
- ArcFace cosine scores are relative ranking signals, not proof that two
  images depict the same person. No universal threshold or automatic
  regeneration decision is used. If scoring is unavailable, the UI does not
  imply that identity was checked.
- The chat requests a usable reference when a self-portrait lacks one, and
  describes any displayed score as indicative rather than conclusive.

### Tests and documentation

- Added regression coverage for unique candidate files, single-batch ranking,
  temporary-file cleanup, trusted scoring methods, FaceID capability checks,
  provider restrictions, and gallery-path migration.
- Converted the phase 5 and phase 6 pure-check files into executable Vitest
  suites. Updated stale expectations for generative intent and gallery
  migration.
- Updated the identity and local-generation guides to describe the actual
  FaceID requirement, optional local scorer, and limitations of image-size and
  similarity claims.

Relevant implementation files include:

- `src/main/batch-face-rank.ts`
- `src/main/image-ipc-generate.ts`
- `src/main/image-provider-selection.ts`
- `src/core/image/faceid-status.ts`
- `src/renderer/src/features/chat/services/chatImageFlow.ts`
- `src/renderer/src/features/chat/components/MessageBubble.tsx`
- `src/renderer/src/features/chat/services/hostTools/executeAppTool.ts`
- `tools/face_similarity.py`
- `tools/identity_match.py`
- `plugins/face-score/` and `plugins/identity-match/`

Related references: [IDENTITY-LOCAL-PLAN.md](./IDENTITY-LOCAL-PLAN.md),
[IDENTITY-C3.md](./IDENTITY-C3.md), [IDENTITY-STACK.md](./IDENTITY-STACK.md),
and [GENERATIVE_LOCAL.md](./GENERATIVE_LOCAL.md).

## Verification results

| Validation | Result |
|---|---|
| `npm test -- src/core/image src/core/generative src/main/image-provider-selection.test.ts` | Passed: 28 files, 141 tests |
| `npm run build` | Passed |
| `npm run typecheck` | Failed: hundreds of TypeScript diagnostics across the current worktree |
| Local ArcFace scorer | Python syntax and CLI protocol checks passed; scoring could not run because the local model was reported missing |
| Generated-image comparison | Not run: the local Forge/model/hardware setup was not available for controlled visual evaluation |

The typecheck failures are repository-wide, including files outside this
change. The worktree also contains pre-existing staged changes, so this run
does not establish which of the overall diagnostics were introduced earlier.
The image-generation test suite and production build do pass.

## Comparison with the product goal

| Goal | Result |
|---|---|
| Keep the same identity across scenes | **Improved safeguards and conditioning path.** A reference and actual FaceID application are now required for self-portraits, and candidates can be ranked locally when ArcFace is available. Visual identity consistency remains unmeasured. |
| Photorealistic output | **Not demonstrated.** The app can use capable local models, but the result still depends on the selected checkpoint, LoRAs, sampling settings, resolution, and hardware. No claim of improved realism is made without a controlled image set. |
| Let the user simply ask in chat | **Safer failure path.** The chat can guide the user to configure a missing reference or FaceID component instead of returning an unrelated face. Automatic model discovery and quality tuning remain separate work. |

## Remaining acceptance work

1. Install and confirm a compatible FaceID model, its required LoRA, and the
   local ArcFace dependencies/model on the target machine.
2. Freeze the avatar reference, Forge checkpoint, prompts, dimensions, and
   sampling parameters. Generate a baseline and a changed pipeline set with
   multiple fixed seeds.
3. Use a blinded human evaluation that separately scores face identity, body
   consistency, realism, and compliance with requested changes (clothing,
   pose, and scene). Preserve all generated images and settings for review.
4. Report pass rates against pre-agreed thresholds. Calibrate any automated
   acceptance rule on labeled local examples; do not treat cosine similarity
   as a universal identity threshold.

Until that evaluation is complete, the defensible conclusion is that the
pipeline now fails more honestly and ranks candidates more consistently—not
that it has achieved the target visual quality.
