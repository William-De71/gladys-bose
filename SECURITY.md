# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Bose app, the Bose cloud and the firmware of the speakers (report to Bose).

The integration holds the password of your Bose account (a Gladys secret,
sent only to the Bose sign-in page, never logged) and, in its `/data`
volume, the Bose tokens (readable by the container user only) and the GUID,
address, name and model of each speaker seen. Anyone holding the token can
control the speakers of the account on your network: keep the Gladys host
and its backups private. The speakers use a self-signed certificate, which
the integration accepts on the local network.
