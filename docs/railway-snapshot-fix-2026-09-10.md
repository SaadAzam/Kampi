# Railway snapshot failure and deployment recovery

The deployment for commit `fa5c645` failed before Railway created a build. API deployment `681b0a0b-868d-4fcd-9f2c-443f6ea18157` reported:

> Failed to create code snapshot. Please review your last commit, or try again.

An explicit build-log lookup returned `Deployment does not have an associated build`. Therefore no application compilation error was available to fix for this deployment. The deployment workflow stopped at the first service, leaving the remaining five services unqueued.

The commit contains 234 tracked files totaling 844,003 bytes; a Git archive compresses to 250,830 bytes. This does not suggest an oversized fresh-checkout upload. The exact failed upload bytes were not retained, so this is a source-size check, not a reproduction of Railway's archive.

## Local changes

- Pin Railway CLI to 5.49.5, matching the version used for the preceding successful local deployments.
- Upload each of the six services sequentially, then wait for the **exact returned deployment ID** to reach `SUCCESS`. A newer successful deployment cannot mask this run's failure.
- Allow at most two retries, after 30 and 60 seconds, only when the deployment explicitly reports the known snapshot error, no build/deploy stage has been observed, and its build-log lookup confirms there is no associated build.
- Do not retry compilation errors, runtime crashes, mixed configuration errors, uncertain upload outcomes, or failures whose build status cannot be verified.
- Bound status waiting to a 15-minute deadline per service, individual CLI calls to two minutes, and the complete Actions job to 50 minutes. A timeout leaves the remote outcome unconfirmed; inspect the recorded deployment ID before rerunning.
- Keep the existing `RAILWAY_API_TOKEN` mapping to the repository's `RAILWAY_TOKEN` secret. Its name alone does not establish the token type, and the failed deployment was authenticated successfully.

The script uses built-in Node modules and adds no dependencies. It prints deployment IDs and status changes for diagnosis. Its recovery tests run in the deployment workflow before any upload.

## Evidence and limits

[Railway's deployment documentation](https://docs.railway.com/cli/up) states that detached uploads return after queuing; this does not confirm a healthy deployment. The [5.49.5 deployment-list source](https://github.com/railwayapp/cli/blob/v5.49.5/src/commands/deployment.rs) defines the supported project/environment/service flags and JSON array containing `id`, `status`, `createdAt`, and `meta`.

The archive-generation and upload payload logic in the official [5.2.0 source](https://github.com/railwayapp/cli/blob/v5.2.0/src/controllers/upload.rs) and [5.49.5 source](https://github.com/railwayapp/cli/blob/v5.49.5/src/controllers/upload.rs) does not establish an old-version snapshot bug. The version update and bounded recovery improve operational consistency; they do not prove or guarantee resolution of Railway's underlying snapshot failure.

Validation: `node --test scripts/deploy-railway.test.mjs` exercises exact-ID tracking, confirmed recovery, retry limits, build/runtime failures, uncertain outcomes, and timeout behavior with mocked CLI responses. No deployment, environment change, commit, or push was performed during this fix. The next committed workflow run will provide live validation.
