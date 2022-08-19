# Snapshot Labs: Proposal creation helper

### Steps 

* Fork the repo
* Add PRIVATE_KEY in Github Settings Secrets
* Add HUB in Github Settings Secrets
    * HUB="https://testnet.snapshot.org" for testnet
    * HUB="https://hub.snapshot.org" for prod

* Every time you update the proposal.json file, it would execute a script using GH Actions and Snapshot.js to publish it.