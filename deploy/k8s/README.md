# Container and Kubernetes reference

**The recommended production path is Vercel + Supabase.** That is what `docs/DEPLOYMENT.md` describes and what the platform is built and tested for. Nothing in this folder is applied anywhere, and nothing here needs to be used.

The owner's brief (section 58) says two things: do not introduce Kubernetes merely for complexity, and keep the platform ready for a container deployment when dedicated infrastructure is required. This folder is the second half. It exists so that the day a container is needed, the security decisions are already written down instead of improvised.

## When a container path would be justified

* A client, a contract or a regulator requires infrastructure dedicated to one organization, in an account the firm or the client controls.
* Lion Business Services decides that its deployment must run inside a private network with no shared hosting.
* A requirement on where the servers are, or on who operates them, that Vercel cannot meet.
* Vercel becomes unavailable or unsuitable and the platform has to move.

When it is not justified: to look more "enterprise", to save cost at small scale (a cluster costs more to run and to secure than the two hosted projects), or because of load (the hosted path scales without action). A cluster is also more to get wrong: every item in the list below becomes the firm's own responsibility.

If the need is only "a server we control", a single container on a managed container service is enough, and Kubernetes is still not needed.

## What exists

| Path | What it is | Verified |
| --- | --- | --- |
| `deploy/container/server.mjs` | A small Node server that serves the build and runs the functions in `api/`, following `vercel.json` (headers, rewrites, time limits). | Run and tested here without Docker: `tests/security/container-server.test.mjs` |
| `deploy/container/healthcheck.mjs` | The health check the image uses (the image has no shell and no curl). | Run here against the server |
| `deploy/container/cron-call.mjs` | Makes the scheduled calls that Vercel Cron makes on Vercel. | Tested here against the server |
| `Dockerfile`, `.dockerignore` | Multi-stage image: build, scan the build, then a final image with Node and the application only, running as a non-root user. | **Not built.** No Docker daemon was available. |
| `deploy/k8s/base` | Deployment, Service, Ingress, network rules, disruption budget, service account, scheduled jobs. | Parsed as YAML only. **Never applied, never rendered with kustomize.** |
| `deploy/k8s/overlays/vyntex`, `deploy/k8s/overlays/lbs` | One namespace per deployment, with its own image, settings and secrets. | Same |

## What the manifests set, against the owner's list

| Asked for (brief, section 58) | In the reference | Left to do when it is used |
| --- | --- | --- |
| Separate namespaces and environments | One namespace per deployment (`vyntex-command`, `lbs-command`), never shared. | Separate clusters or accounts for LBS if the isolation requirement says so. A staging namespace per deployment. |
| Least-privilege service accounts | An account with no role; no API token is mounted in the pod. | |
| Network policies | Default deny in the namespace. In: from the ingress controller and from the scheduled jobs only. Out: name lookups and HTTPS to public addresses only, never to private ranges or the cloud metadata address. | Rules by host name (the Supabase project, each provider) need the cluster network's own policy type or an egress gateway. Confirm the cluster enforces NetworkPolicy at all. |
| Secret management | Secrets are referenced by name; `secret.example.yaml` lists names only and is not applied. | A secret store with an operator (External Secrets or the Secrets Store CSI driver), encryption of Secrets at rest in the cluster, and access to Secrets limited by role. |
| Non-root containers | `runAsNonRoot`, user 65532, no privilege escalation, every capability dropped, default seccomp profile. | |
| Read-only file systems | `readOnlyRootFilesystem: true`. The server writes nothing to disk. | |
| Resource limits | Requests and limits on every container. | The numbers are starting values. Measure and replace them. |
| Image vulnerability scanning | Not included. | Scan the image in the registry and in CI before it is deployed, and fail on serious findings. |
| Signed images and provenance | Images are referenced by digest, never by tag. | Sign the image at build (for example with cosign) and make the cluster refuse unsigned images. Not set up. |
| Controlled ingress, TLS | One Ingress, HTTPS only, one host per deployment. | A certificate tool in the cluster, and the web application firewall of the cloud if required. |
| Pod security standards | The namespaces enforce the "restricted" standard. | |
| Audit logging | Not a manifest. | Turn on the audit log of the managed cluster and send it to a store the firm controls. |
| Rolling deployments | Rolling update with no unavailable copy, readiness and liveness probes, a disruption budget, graceful stop in the server. | |
| Backup and recovery | Not in the cluster: the database stays a managed PostgreSQL (Supabase or another), with the same procedure as `docs/security/backup-and-recovery.md`. | |
| Infrastructure as code | These manifests. | The cluster, network and database themselves should be created from code (Terraform or the cloud's own tool), in a separate repository with its own reviews. |
| Managed Kubernetes | Assumed. | Do not hand-build a control plane. |

## The database in a container deployment

The server functions reach the database through Supabase's HTTPS interface (sign-in service and data interface), not through a direct database connection. A container deployment therefore still needs those two services in front of PostgreSQL: a Supabase project (hosted, or Supabase's self-hosted stack), reached over HTTPS. Running the platform against a bare PostgreSQL server is not supported by the server code today. For private database access (brief, section 59), the place to restrict is the network between the cluster and that Supabase project.

## Building the image

Not done here. When it is needed:

1. IN: VS Code. Open `Dockerfile` and read the comment at the top.
2. IN: VS Code terminal. Find the digest of each base image and put it in the two `ARG` lines:

   ```
   docker buildx imagetools inspect node:22-bookworm-slim
   docker buildx imagetools inspect gcr.io/distroless/nodejs22-debian12:nonroot
   ```

3. IN: VS Code terminal. Build one image per deployment:

   ```
   docker build --build-arg VX_DEPLOY=vyntex -t vyntex-command .
   docker build --build-arg VX_DEPLOY=lbs -t lbs-command .
   ```

   The build runs the bundle scan and the header check and stops if either fails.
4. IN: VS Code terminal. Start it the way production would, read-only and without privileges, and look at it:

   ```
   docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges -p 8080:8080 vyntex-command
   ```

5. IN: a browser. Open `http://localhost:8080/healthz` (answers "ok") and `http://localhost:8080/`.

Unverified until someone does these steps: that the image builds, the path of the Node program inside the distroless image used by the health check (`/nodejs/bin/node`), and the size and start time of the result.

## What differs from Vercel when running in a container

| On Vercel | In a container |
| --- | --- |
| `VERCEL_ENV` tells the server it is production | Set `VX_ENV=production` (the image does by default). Without it the server would behave as on a developer's computer, cookies without the Secure flag included. |
| Vercel passes the visitor's address | The server takes it from the connection, or from the ingress when `TRUST_PROXY=1`. Set that only when every request comes through your own ingress. |
| Vercel Cron calls `/api/cron/tick` and `/api/cron/daily` | `cronjobs.yaml` does. Keep the schedules equal to `vercel.json`; a test checks that they are. |
| Vercel ends a function after its time limit | The server does the same, with the limits from `vercel.json`. |
| Preview deployments per branch | None. Build and run a staging copy deliberately. |
| TLS and HTTP compression | Done by the ingress. The server speaks plain HTTP inside the cluster and does not compress. |

## Using the manifests

They are a starting point for a platform engineer, not a turnkey setup. Before first use: replace every `REGISTRY`, digest and host placeholder, create the Secret from a secret store, adjust the ingress controller's namespace label in `base/networkpolicy.yaml`, and render and review the result:

```
kubectl kustomize deploy/k8s/overlays/lbs
```

Apply to a test cluster first. Each deployment is applied separately, by people who have access to that deployment only.
