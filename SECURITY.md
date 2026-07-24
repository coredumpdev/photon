# Security Policy

## Supported versions

Photon is pre-1.0; only the **latest** published `0.x` release of the
`@photonviz/*` packages receives security fixes.

| Version | Supported |
| ------- | --------- |
| latest `0.x` | ✅ |
| older | ❌ |

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

- Preferred: open a [private security advisory](https://github.com/coredumpdev/photon/security/advisories/new) on GitHub.
- Or email **muzaffertolgayakar@gmail.com** with a description, affected version(s), and a minimal reproduction.

You can expect an acknowledgement within a few days. Once a fix is ready we'll
publish a patched release and credit you (unless you prefer to stay anonymous).

Photon renders untrusted **data**, not untrusted code — it ships zero runtime
dependencies and runs entirely client-side in WebGL2, so the most relevant
concerns are input handling (malformed arrays / CSV / GeoJSON) and DoS via
pathological inputs. Reports in those areas are very welcome.
