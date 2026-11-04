# Test fixtures

`descriptors.json` is shared by the Node and Python contract tests.

`tls-cert.txt` and `tls-key.txt` are a self-signed **test-only** localhost certificate/key, deliberately untrusted by the production transports. Tests verify certificate rejection, then explicitly trust this test certificate only in the injected Node test requester to exercise HTTP status handling. These files are not application credentials and are never loaded by the production installers.
