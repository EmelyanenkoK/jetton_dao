import { Blockchain, SandboxContract, TreasuryContract, Verbosity, internal } from '@ton-community/sandbox';
import { Cell, toNano, beginCell, Address, SendMode } from 'ton-core';
import { JettonWallet } from '../../wrappers/JettonWallet';
import { JettonMinter } from '../../wrappers/JettonMinter';
import { Voting } from '../../wrappers/Voting';
import { VoteKeeper } from '../../wrappers/VoteKeeper';
import '@ton-community/test-utils';
import { compile } from '@ton-community/blueprint';
import { getRandom, getRandomExp, getRandomInt, getRandomTon, randomAddress, renewExp } from "../utils";
import { exists } from 'fs';


describe('Votings', () => {
    let jwallet_code = new Cell();
    let minter_code = new Cell();
    let voting_code = new Cell();
    let vote_keeper_code = new Cell();
    let blockchain: Blockchain;
    let user1:SandboxContract<TreasuryContract>;
    let user2:SandboxContract<TreasuryContract>;
    let user3:SandboxContract<TreasuryContract>;
    let initialUser1Balance:bigint;
    let initialUser2Balance:bigint;
    let initialUser3Balance:bigint;
    let DAO:SandboxContract<JettonMinter>;
    let userWallet:any;
    let votingContract:any;
    let voteKeeperContract:any;
    let defaultContent:Cell;
    let expirationDate:bigint;

    beforeAll(async () => {
        jwallet_code = await compile('JettonWallet');
        minter_code = await compile('JettonMinter');
        voting_code = await compile('Voting');
        vote_keeper_code = await compile('VoteKeeper');
        blockchain = await Blockchain.create();
        user1 = await blockchain.treasury('user1');
        user2 = await blockchain.treasury('user2');
        user3 = await blockchain.treasury('user3');
        initialUser1Balance = toNano('777');
        initialUser2Balance = toNano('333');
        initialUser3Balance = toNano('105');
        defaultContent = beginCell().endCell();
        DAO = blockchain.openContract(
                   await JettonMinter.createFromConfig(
                     {
                       admin: user1.address,
                       content: defaultContent,
                       wallet_code: jwallet_code,
                       voting_code: voting_code,
                       vote_keeper_code: vote_keeper_code
                     },
                     minter_code));
        userWallet = async (address:Address) => blockchain.openContract(
                          JettonWallet.createFromAddress(
                            await DAO.getWalletAddress(address)
                          )
                     );
        votingContract = async (voting_id:bigint) => blockchain.openContract(
                          Voting.createFromAddress(
                            await DAO.getVotingAddress(voting_id)
                          )
                     );
        //voteKeeperContract = TODO
        await DAO.sendDeploy(user1.getSender(), toNano('1'));
        await DAO.sendMint(user1.getSender(), user1.address, initialUser1Balance, toNano('0.05'), toNano('1'));
        await DAO.sendMint(user1.getSender(), user2.address, initialUser2Balance, toNano('0.05'), toNano('1'));
        await DAO.sendMint(user1.getSender(), user3.address, initialUser3Balance, toNano('0.05'), toNano('1'));
    });
    it('should create new voting', async () => {
            expirationDate = getRandomExp();
            let voting = await votingContract(0n);

            let createVoting = await DAO.sendCreateVoting(user1.getSender(),
                expirationDate,
                toNano('0.1'), // minimal_execution_amount
                randomAddress(),
                toNano('0.1'), // amount
                beginCell().endCell() // payload
            );
            expect(createVoting.transactions).toHaveTransaction({ //notification
                        from: DAO.address,
                        to: user1.address,
                        body: beginCell().storeUint(0xc39f0be6, 32) //// voting created
                                         .storeUint(0, 64) //query_id
                                         .storeAddress(voting.address) //voting_code
                                         .endCell()
                    });
        });
    it('jetton owner can vote', async () => {
            let voting = await votingContract(0n);
            let votingData = await voting.getData();
            expect(votingData.init).toEqual(true);
            expect(votingData.votedFor).toEqual(0n);
            expect(votingData.votedAgainst).toEqual(0n);
            let votingCode = await DAO.getVotingCode();
            const user1JettonWallet = await userWallet(user1.address);
            let voteResult = await user1JettonWallet.sendVote(user1.getSender(), voting.address, expirationDate, true, false);
            expect(voteResult.transactions).toHaveTransaction({ //notification
                        from: voting.address,
                        to: user1.address,
                        // excesses 0xd53276db, query_id
                        body: beginCell().storeUint(0xd53276db, 32).storeUint(0, 64).endCell()
                    });
            votingData = await voting.getData();
            expect(votingData.init).toEqual(true);
            expect(votingData.votedFor).toEqual(initialUser1Balance);
            expect(votingData.votedAgainst).toEqual(0n);
            expect(await user1JettonWallet.getJettonBalance()).toEqual(0n);
        });
        it('jetton owner can not transfer just after voting', async () => {
            const user1JettonWallet = await userWallet(user1.address);
            let transferResult = await user1JettonWallet.sendTransfer(user1.getSender(), toNano('0.1'), //tons
                   1n, user1.address,
                   user1.address, null, toNano('0.05'), null);
            expect(transferResult.transactions).toHaveTransaction({ //failed transfer
                        from: user1.address,
                        to: user1JettonWallet.address,
                        exitCode: 706 //error::not_enough_jettons = 706;
                    });
        });
        it('jetton owner can transfer tokens which did not vote', async () => {
            const user2JettonWallet = await userWallet(user2.address);
            await user2JettonWallet.sendTransfer(user2.getSender(), toNano('0.15'), //tons
                   2n, user1.address,
                   user1.address, null, toNano('0.05'), null);
            const user1JettonWallet = await userWallet(user1.address);
            expect(await user1JettonWallet.getJettonBalance()).toEqual(2n);
            let transferResult = await user1JettonWallet.sendTransfer(user1.getSender(), toNano('0.15'), //tons
                   1n, user2.address,
                   user1.address, null, toNano('0.05'), null);
            expect(transferResult.transactions).not.toHaveTransaction({ //failed transfer
                        from: user1.address,
                        to: user1JettonWallet.address,
                        exitCode: 706 //error::not_enough_jettons = 706;
                    });
            expect(transferResult.transactions).toHaveTransaction({ // excesses
                        from: user2JettonWallet.address,
                        to: user1.address,
                        // excesses 0xd53276db, query_id
                        body: beginCell().storeUint(0xd53276db, 32).storeUint(0, 64).endCell()
                    });
            expect(await user1JettonWallet.getJettonBalance()).toEqual(1n);
        });
        it('jetton owner can vote second time but only with new jettons', async () => {
            let voting     = await votingContract(0n);
            let votingCode = await DAO.getVotingCode();
            const user1JettonWallet = await userWallet(user1.address);
            let voteResult = await user1JettonWallet.sendVote(user1.getSender(), voting.address, expirationDate, false, false);
            expect(voteResult.transactions).toHaveTransaction({ //notification
                        from: voting.address,
                        to: user1.address,
                        // excesses 0xd53276db, query_id
                        body: beginCell().storeUint(0xd53276db, 32).storeUint(0, 64).endCell()
                    });
            let votingData = await voting.getData();
            expect(votingData.init).toEqual(true);
            expect(votingData.votedFor).toEqual(initialUser1Balance);
            expect(votingData.votedAgainst).toEqual(1n);
            expect(await user1JettonWallet.getJettonBalance()).toEqual(0n);
        });

    it('jetton owner can vote in the other voting', async () => {
            let voting     = await votingContract(1n);
            expirationDate = renewExp(expirationDate);

            const createVoting = await DAO.sendCreateVoting(user1.getSender(),
                expirationDate,
                toNano('0.1'), // minimal_execution_amount
                randomAddress(),
                toNano('0.1'), // amount
                beginCell().endCell() // payload
            );

            expect(createVoting.transactions).toHaveTransaction({
                from: DAO.address,
                to: user1.address,
                body: beginCell().storeUint(0xc39f0be6, 32) //// voting created
                                         .storeUint(0, 64) //query_id
                                         .storeAddress(voting.address) //voting_code
                                         .endCell()

            });
            let votingData = await voting.getData();
            expect(votingData.init).toEqual(true);
            expect(votingData.votedFor).toEqual(0n);
            expect(votingData.votedAgainst).toEqual(0n);
            let votingCode = await DAO.getVotingCode();
            const user1JettonWallet = await userWallet(user1.address);
            let voteResult = await user1JettonWallet.sendVote(user1.getSender(), voting.address, expirationDate, true, false);
            expect(voteResult.transactions).toHaveTransaction({ //notification
                        from: voting.address,
                        to: user1.address,
                        // excesses 0xd53276db, query_id
                        body: beginCell().storeUint(0xd53276db, 32).storeUint(0, 64).endCell()
                    });

            votingData = await voting.getData();
            expect(votingData.init).toEqual(true);
            expect(votingData.votedFor).toEqual(initialUser1Balance + 1n);
            expect(votingData.votedAgainst).toEqual(0n);
            expect(await user1JettonWallet.getJettonBalance()).toEqual(0n);
        });
    it('jetton owner can vote with confirmation', async () => {
            expirationDate = renewExp(expirationDate);
            await DAO.sendCreateVoting(user1.getSender(),
                expirationDate,
                toNano('0.1'), // minimal_execution_amount
                randomAddress(),
                toNano('0.1'), // amount
                beginCell().endCell() // payload
            );
            let voting = await votingContract(2n);
            let votingCode = await DAO.getVotingCode();
            const user1JettonWallet = await userWallet(user1.address);
            let voteResult = await user1JettonWallet.sendVote(user1.getSender(), voting.address, expirationDate, false, true);
            expect(voteResult.transactions).toHaveTransaction({ //vote_confirmation
                        from: user1JettonWallet.address,
                        to: user1.address,
                        body: beginCell().storeUint(0x5fe9b8ca, 32).storeUint(0, 64).endCell()
                    });
            let votingData = await voting.getData();
            expect(votingData.init).toEqual(true);
            expect(votingData.votedFor).toEqual(0n);
            expect(votingData.votedAgainst).toEqual(initialUser1Balance + 1n);
            expect(await user1JettonWallet.getJettonBalance()).toEqual(0n);
        });
        it('jetton balance unblocked after expiration date', async () => {
            const user1JettonWallet = await userWallet(user1.address);
            // await new Promise(res => setTimeout(res, Number((expirationDate + 1n) * 1000n) - Date.now()));
            // expect(await user1JettonWallet.getJettonBalance({now: expirationDate + 1n})).toEqual(initialUser1Balance + 1n);
            const wdata = await blockchain.runGetMethod(user1JettonWallet.address, 'get_wallet_data', [], {now: Number(expirationDate) + 1 });
            expect(wdata.stackReader.readBigNumber()).toBe(initialUser1Balance + 1n);
            // check that voting data didn't changed
            let voting = await votingContract(0n);
            let votingData = await voting.getData();
            expect(votingData.init).toEqual(true);
            expect(votingData.votedFor).toEqual(initialUser1Balance);
            expect(votingData.votedAgainst).toEqual(1n);
        });
        // TODO
        // check voteKeeper data in tests

        //DAO tests
        //provide_voting_data
        //execute_vote_result (successful: VoteFor won)
        //execute_vote_result (failed: VoteAgainst won)
        //upgrade_codes
        // Negative (unauthorized):
        //  voting_initiated
        //  execute_vote_result
        //  request_confirm_voting
        //  upgrade_code
        // Special case that DAO can be it's own owner:
        //  1. Transfer admin rights to DAO
        //  2. Mint through voting
        //  3. Transfer admin rights back to "usual user"

        // JettonWallet tests
        //  create voting with wallet
        //  clean expired votings
        //  check that expired votings are deleted on next voting
        // Negative (unauthorized):
        //  vote
        //  create_voting
        //  confirm_voting
        //  voting_created
        //  clean_expired_votings
        // Negative:
        //  can not vote with expiration_date < now

        // Voting tests
        // negative (unauthorized):
        // init_voting
        // submit_votes
        // end_voting
        // end_voting (too early)
        // end_voting (too less money)
        // end_voting (second time)
        // Negative (wrong data)
        // wrong expiration date

        // VoteKeeper
        // unauthorized vote

        // Adjust storage fees


});
