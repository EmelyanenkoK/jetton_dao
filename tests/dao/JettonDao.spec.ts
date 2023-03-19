import { Blockchain, SandboxContract, TreasuryContract, Verbosity, internal } from '@ton-community/sandbox';
import { Cell, toNano, beginCell, Address, SendMode, OpenedContract } from 'ton-core';
import { JettonWallet } from '../../wrappers/JettonWallet';
import { JettonMinter } from '../../wrappers/JettonMinter';
import { Voting } from '../../wrappers/Voting';
import { VoteKeeper } from '../../wrappers/VoteKeeper';
import '@ton-community/test-utils';
import { compile } from '@ton-community/blueprint';
import { getRandom, getRandomExp, getRandomInt, getRandomPayload, getRandomTon, randomAddress, renewExp } from "../utils";

type voteCtx = {
    init: boolean,
    votedFor: bigint,
    votedAgainst: bigint
};

type ActiveWallet       = SandboxContract<TreasuryContract>;
type ActiveJettonWallet = SandboxContract<JettonWallet>;

type balanceSortResult  = {
    min: ActiveJettonWallet,
    max: ActiveJettonWallet,
    isEq: boolean,
    hasZero: boolean
};


describe('Votings', () => {
    jest.setTimeout(15000);
    let jwallet_code = new Cell();
    let minter_code = new Cell();
    let voting_code = new Cell();
    let vote_keeper_code = new Cell();
    let blockchain: Blockchain;
    let user1:ActiveWallet;
    let user2:ActiveWallet;
    let user3:ActiveWallet;
    let initialUser1Balance:bigint;
    let initialUser2Balance:bigint;
    let initialUser3Balance:bigint;
    let votes:voteCtx[] = []; // Array index is voting index
    let sortBalance:(w1:ActiveJettonWallet, w2:ActiveJettonWallet) => Promise<balanceSortResult>;
    let DAO:SandboxContract<JettonMinter>;
    let userWallet:(address:Address) => Promise<ActiveJettonWallet>;
    let votingContract:(voting_id:bigint) => Promise<SandboxContract<Voting>>;
    let voteKeeperContract:(wallet:ActiveJettonWallet, keeper_addr:Address) => Promise<SandboxContract<VoteKeeper>>;
    let defaultContent:Cell;
    let expirationDate:bigint;
    let assertKeeper:(vAddr:Address, wallet:ActiveJettonWallet, votes:bigint) => void;

    beforeAll(async () => {
        jwallet_code = await compile('JettonWallet');
        minter_code = await compile('JettonMinter');
        voting_code = await compile('Voting');
        vote_keeper_code = await compile('VoteKeeper');
        blockchain = await Blockchain.create();
        user1 = await blockchain.treasury('user1');
        user2 = await blockchain.treasury('user2');
        user3 = await blockchain.treasury('user3');
        initialUser1Balance = getRandomTon(100, 1000);
        initialUser2Balance = getRandomTon(100, 1000);
        initialUser3Balance = getRandomTon(100, 1000);
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
        voteKeeperContract = async (jw:ActiveJettonWallet, voting_addr:Address) => blockchain.openContract(
            VoteKeeper.createFromAddress(
                await jw.getVoteKeeperAddress(voting_addr)
            )
        );

        sortBalance = async (w1:ActiveJettonWallet, w2:ActiveJettonWallet) => {
            const balance1 = await w1.getJettonBalance();
            const balance2 = await w2.getJettonBalance();
            let sortRes:balanceSortResult;

            if(balance1 >= balance2) {
                sortRes = {
                    min: w2,
                    max: w1,
                    isEq: balance1 == balance2,
                    hasZero: balance2 == 0n
                };
            }
            else {
                sortRes = {
                    min: w1,
                    max: w2,
                    isEq: false,
                    hasZero: balance1 == 0n
                };
            }

            return sortRes;
        };

        assertKeeper = async (vAddr: Address, wallet:ActiveJettonWallet, expVotes:bigint) => {
            const keepR      = await voteKeeperContract(wallet, vAddr);
            const keeperData = await keepR.getData();

            expect(keeperData.voter_wallet.equals(wallet.address)).toBeTruthy();
            expect(keeperData.voting.equals(vAddr)).toBeTruthy();
            expect(keeperData.votes).toEqual(expVotes);


   }

        await DAO.sendDeploy(user1.getSender(), toNano('1'));
        await DAO.sendMint(user1.getSender(), user1.address, initialUser1Balance, toNano('0.05'), toNano('1'));
        await DAO.sendMint(user1.getSender(), user2.address, initialUser2Balance, toNano('0.05'), toNano('1'));
        await DAO.sendMint(user1.getSender(), user3.address, initialUser3Balance, toNano('0.05'), toNano('1'));
    });
    it('should create new voting', async () => {
            expirationDate = getRandomExp();
            const votingId = 0n;
            let voting = await votingContract(votingId);

            const randTon    = getRandomTon(1, 2000);
            const payload    = getRandomPayload();
            const minExec    = toNano('0.1');

            let createVoting = await DAO.sendCreateVoting(user1.getSender(),
                expirationDate,
                minExec, // minimal_execution_amount
                randomAddress(),
                toNano('0.1'), // amount
                payload // payload
            );

            expect(createVoting.transactions).toHaveTransaction({ //notification
                        from: DAO.address,
                        to: user1.address,
                        body: beginCell().storeUint(0xc39f0be6, 32) //// voting created
                                         .storeUint(0, 64) //query_id
                                         .storeAddress(voting.address) //voting_code
                                         .endCell()
                    });

            const votingData = await voting.getData();

            votes[0] = votingData;

            const proposal = JettonMinter.createProposalBody(minExec, payload);

            expect(votingData.votingId).toEqual(votingId);
            expect(votingData.daoAddress.equals(DAO.address)).toBeTruthy();
            expect(votingData.proposal.equals(proposal)).toBeTruthy();
            expect(votingData.executed).toBe(false);
            expect(votingData.expirationDate).toEqual(expirationDate);
            expect(votingData.initiator.equals(user1.address)).toBeTruthy();
            expect(votingData.init).toEqual(true);
            expect(votingData.votedFor).toEqual(0n);
            expect(votingData.votedAgainst).toEqual(0n);
    });

    it('jetton owner can vote for', async () => {
            let voting     = await votingContract(0n);

            let votingCode = await DAO.getVotingCode();
            const user1JettonWallet = await userWallet(user1.address);
            const voteCtx  = votes[0];
            let voteResult = await user1JettonWallet.sendVote(user1.getSender(), voting.address, expirationDate, true, false);
            expect(voteResult.transactions).toHaveTransaction({ //notification
                        from: voting.address,
                        to: user1.address,
                        // excesses 0xd53276db, query_id
                        body: beginCell().storeUint(0xd53276db, 32).storeUint(0, 64).endCell()
                    });


            voteCtx.votedFor += initialUser1Balance;

            await assertKeeper(voting.address, user1JettonWallet, voteCtx.votedFor);

            const votingData = await voting.getData();

            expect(votingData.init).toEqual(voteCtx.init);
            expect(votingData.votedFor).toEqual(initialUser1Balance);
            expect(votingData.votedAgainst).toEqual(voteCtx.votedAgainst);
            expect(await user1JettonWallet.getJettonBalance()).toEqual(voteCtx.votedAgainst);


        });

        it('jetton owner can vote against', async () => {

            let voting     = await votingContract(0n);
            let votingData = await voting.getData();
            let voteCtx    = votes[0];

            expect(votingData.init).toEqual(voteCtx.init);
            expect(votingData.votedFor).toEqual(voteCtx.votedFor);
            expect(votingData.votedAgainst).toEqual(voteCtx.votedAgainst);

            const user3JettonWallet = await userWallet(user3.address);
            const voteRes           = await user3JettonWallet.sendVote(user3.getSender(), voting.address, expirationDate, false, false);


            expect(voteRes.transactions).toHaveTransaction({ //notification
                        from: voting.address,
                        to: user3.address,
                        // excesses 0xd53276db, query_id
                        body: beginCell().storeUint(0xd53276db, 32).storeUint(0, 64).endCell()
                    });


            voteCtx.votedAgainst += initialUser3Balance;

            await assertKeeper(voting.address, user3JettonWallet, voteCtx.votedAgainst);

            votingData     = await voting.getData();
            expect(votingData.init).toEqual(voteCtx.init);
            expect(votingData.votedFor).toEqual(voteCtx.votedFor);
            expect(votingData.votedAgainst).toEqual(voteCtx.votedAgainst);

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
            const transferVal = getRandomTon(2, 10);
            await user2JettonWallet.sendTransfer(user2.getSender(), toNano('0.15'), //tons
                   transferVal, user1.address,
                   user1.address, null, toNano('0.05'), null);
            const user1JettonWallet = await userWallet(user1.address);
            expect(await user1JettonWallet.getJettonBalance()).toEqual(transferVal);
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
            expect(await user1JettonWallet.getJettonBalance()).toEqual(transferVal - 1n);
        });

        it('jetton owner can vote second time but only with new jettons', async () => {
            let voting     = await votingContract(0n);
            const voteCtx  = votes[0];
            let votingCode = await DAO.getVotingCode();
            const user1JettonWallet = await userWallet(user1.address);
            const walletData = await user1JettonWallet.getDaoData();
            let voteResult = await user1JettonWallet.sendVote(user1.getSender(), voting.address, expirationDate, false, false);
            expect(voteResult.transactions).toHaveTransaction({ //notification
                        from: voting.address,
                        to: user1.address,
                        // excesses 0xd53276db, query_id
                        body: beginCell().storeUint(0xd53276db, 32).storeUint(0, 64).endCell()
                    });

            voteCtx.votedAgainst += walletData.balance;

            await assertKeeper(voting.address, user1JettonWallet, walletData.balance + walletData.locked);

            const votingData = await voting.getData();

            expect(votingData.init).toEqual(voteCtx.init);
            expect(votingData.votedFor).toEqual(voteCtx.votedFor);
            expect(votingData.votedAgainst).toEqual(voteCtx.votedAgainst);
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

            const voteCtx  = votingData as voteCtx;
            votes[1]       = voteCtx;


            const user1JettonWallet = await userWallet(user1.address);
            const walletBalance     = await user1JettonWallet.getLockedBalance();
            let voteResult = await user1JettonWallet.sendVote(user1.getSender(), voting.address, expirationDate, true, false);

            expect(voteResult.transactions).toHaveTransaction({ //notification
                        from: voting.address,
                        to: user1.address,
                        // excesses 0xd53276db, query_id
                        body: beginCell().storeUint(0xd53276db, 32).storeUint(0, 64).endCell()
                    });

            voteCtx.votedFor += walletBalance;

            await assertKeeper(voting.address, user1JettonWallet, voteCtx.votedFor);

            votingData = await voting.getData();

            expect(votingData.init).toEqual(voteCtx.init);
            expect(votingData.votedFor).toEqual(voteCtx.votedFor);
            expect(votingData.votedAgainst).toEqual(voteCtx.votedAgainst);
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
            const voteCtx  = (await voting.getData()) as voteCtx;
            votes[2]       = voteCtx;

            let votingCode = await DAO.getVotingCode();
            const user1JettonWallet = await userWallet(user1.address);
            const walletBalance     = await user1JettonWallet.getTotalBalance();

            let voteResult = await user1JettonWallet.sendVote(user1.getSender(), voting.address, expirationDate, false, true);
            expect(voteResult.transactions).toHaveTransaction({ //vote_confirmation
                        from: user1JettonWallet.address,
                        to: user1.address,
                        body: beginCell().storeUint(0x5fe9b8ca, 32).storeUint(0, 64).endCell()
                    });

            voteCtx.votedAgainst += walletBalance;


            await assertKeeper(voting.address, user1JettonWallet, voteCtx.votedAgainst);

            let votingData = await voting.getData();

            expect(votingData.init).toEqual(voteCtx.init);
            expect(votingData.votedFor).toEqual(voteCtx.votedFor);
            expect(votingData.votedAgainst).toEqual(voteCtx.votedAgainst);

            expect(await user1JettonWallet.getJettonBalance()).toEqual(0n);
        });

        it.skip('jetton balance unblocked after expiration date', async () => {
            const user1JettonWallet = await userWallet(user1.address);
            let   daoData           = await user1JettonWallet.getDaoData();

            expect(daoData.locked).toBeGreaterThan(0n);

            const totalBalance      = daoData.balance + daoData.locked;

            // blockchain.now = Number(expirationDate + 1n);

            // await new Promise(res => setTimeout(res, Number((expirationDate + 1n) * 1000n) - Date.now()));
            // expect(await user1JettonWallet.getJettonBalance()).toEqual(totalBalance);

            daoData = await user1JettonWallet.getDaoData();
            expect(daoData.locked).toEqual(0n);
            expect(daoData.lockExpiration).toBe(0);

            // const wdata = await blockchain.runGetMethod(user1JettonWallet.address, 'get_wallet_data', [], /*{now: Number(expirationDate) + 1 }*/);
            // expect(wdata.stackReader.readBigNumber()).toEqual(totalBalance);
            // check that voting data didn't changed
            let voting     = await votingContract(0n);
            let votingData = await voting.getData();
            const voteCtx  = votes[0];
            expect(votingData.init).toEqual(voteCtx.init);
            expect(votingData.votedFor).toEqual(voteCtx.votedFor);
            expect(votingData.votedAgainst).toEqual(voteCtx.votedAgainst);
        });

        it('Vote won', async () => {

            let winner:ActiveWallet;
            let losser:ActiveWallet;

            const expNumber  = Number(expirationDate);
            expirationDate   = getRandomExp();

            const payload    = getRandomPayload();
            const execAmount = toNano('1.1');

            let voting = await votingContract(3n);

            const votingRes = await DAO.sendCreateVoting(user1.getSender(),
                expirationDate,
                toNano('0.1'), // minimal_execution_amount
                randomAddress(),
                toNano('0.5'), // amount
                payload // payload
            );

            expect(votingRes.transactions).toHaveTransaction({ //notification
                        from: DAO.address,
                        to: user1.address,
                        body: beginCell().storeUint(0xc39f0be6, 32) //// voting created
                                         .storeUint(0, 64) //query_id
                                         .storeAddress(voting.address) //voting_code
                                         .endCell()
            });

            const user1JettonWallet = await userWallet(user1.address);
            const user2JettonWallet = await userWallet(user2.address);

            const comp = await sortBalance(user1JettonWallet, user2JettonWallet);

            // Meh
            if(comp.max == user1JettonWallet) {
                winner = user1;
                losser = user2;
            }
            else {
                winner = user2;
                losser = user1;
            }


            const mintAmount = comp.isEq || comp.hasZero
                             ? getRandomTon(1, 10)
                             : 0n;

            if(comp.isEq) {
                // Topup the largest so balance is not equal
                await DAO.sendMint(user1.getSender(),
                                   winner.address,
                                   mintAmount,
                                   toNano('0.05'),
                                   toNano('1'));
            }
            if(comp.hasZero) {
                // Topup lowest in case it's zero
                    await DAO.sendMint(user1.getSender(),
                                       losser.address,
                                       mintAmount - 1n, // Make sure both have different balances
                                       toNano('0.05'),
                                       toNano('1'));

           }

           await comp.max.sendVote(winner.getSender(),
                                   voting.address,
                                   expirationDate, true, false);

           await comp.max.sendVote(losser.getSender(),
                                   voting.address,
                                   expirationDate, false, false);

           blockchain.now = Number(expirationDate) + 1;
           // await new Promise(res => setTimeout(res, Number(td * 1000n)));

           let voteData = await voting.getData();
           expect(voteData.executed).toBe(false);

           const res = await voting.sendEndVoting(user1.getSender(), execAmount);

           expect(res.transactions).toHaveTransaction({
               from: voting.address,
               to: DAO.address,
               body: beginCell().storeUint(0x4f0f7510, 32)
                                .storeUint(0, 64)
                                .storeUint(3, 64)
                                .storeUint(expirationDate, 48)
                                .storeCoins(voteData.votedFor)
                                .storeCoins(voteData.votedAgainst)
                                .storeRef(payload)
                                .endCell()
           });

           voteData = await voting.getData();
           expect(voteData.executed).toBe(true);
        })

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
