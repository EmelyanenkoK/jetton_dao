import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from 'ton-core';
import { JettonWallet, JettonWalletConfig, jettonWalletConfigToCell } from './JettonWallet';

export class JettonWalletTests extends JettonWallet {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {
        super(address, init);
    }

    static createFromAddress(address: Address) {
        return new JettonWalletTests(address);
    }

    static createFromConfig(config: JettonWalletConfig, code: Cell, workchain = 0) {
        const data = jettonWalletConfigToCell(config);
        const init = { code, data };
        return new JettonWalletTests(contractAddress(workchain, init), init);
    }

    static createConfirmMessage(query_id:bigint = 0n) {
        return beginCell().storeUint(0x039a374e, 32).storeUint(query_id, 64).endCell();
    }
    async sendConfirmVote(provider: ContractProvider, via:Sender, value:bigint = toNano('0.1')) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            value,
            body: JettonWalletTests.createConfirmMessage()
        });
    }
    static votingCreatedMessage(voting_address:Address, query_id:bigint = 0n) {
        return beginCell().storeUint(0xc39f0be6, 32)
                        .storeUint(query_id, 64)
                        .storeAddress(voting_address)
                        .endCell();
    }
    async sendVotingCreated(provider: ContractProvider, via:Sender, voting_address:Address, value:bigint = toNano('0.1')) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            value,
            body: JettonWalletTests.votingCreatedMessage(voting_address)
        });
    }
}
