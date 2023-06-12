import { Blockchain, SandboxContract, TreasuryContract, Verbosity, internal, SendMessageResult } from '@ton-community/sandbox';
import { Cell, toNano, beginCell, Address, SendMode, Sender } from 'ton-core';
import { JettonWallet, jettonWalletConfigToCell } from '../../wrappers/JettonWallet';
import { JettonMinter, jettonMinterConfigToCell } from '../../wrappers/JettonMinter';
import { Voting } from '../../wrappers/Voting';
import { VoteKeeper } from '../../wrappers/VoteKeeper';
import '@ton-community/test-utils';
import { compile } from '@ton-community/blueprint';
import { getRandom, getRandomExp, getRandomInt, getRandomPayload, getRandomTon, randomAddress, renewExp, ActiveWallet, ActiveJettonWallet, commonMsg } from "../utils";
import { JettonWalletTests } from '../../wrappers/JettonWalletTests';
import { Op } from "../../Ops";

/*
   These tests check compliance with the TEP-74 and TEP-89,
   but also checks some implementation details.
   If you want to keep only TEP-74 and TEP-89 compliance tests,
   you need to remove/modify the following tests:
     mint tests (since minting is not covered by standard)
     exit_codes
*/

//jetton params
let fwd_fee = 1804014n, gas_consumption = 19500000n, min_tons_for_storage = 10000000n, max_voting_duration = 2592000;

describe('JettonWallet', () => {// return;
    let jwallet_code = new Cell();
    let minter_code = new Cell();
    let voting_code = new Cell();
    let vote_keeper_code = new Cell();
    let blockchain: Blockchain;
    let deployer:SandboxContract<TreasuryContract>;
    let notDeployer:SandboxContract<TreasuryContract>;
    let jettonMinter:SandboxContract<JettonMinter>;
    let userWallet: (address:Address) => Promise<ActiveJettonWallet>;
    let testWallet: (address:Address) => Promise<SandboxContract<JettonWalletTests>>;
    let defaultContent:Cell;
    let votingId:bigint;
    let assertVoteCreation:(via:Sender, jettonWallet:ActiveJettonWallet, voting:Address, expDate:bigint, prop:Cell, expErr:number) => Promise<SendMessageResult>;
    let assertWalletVote:(via:Sender, jettonWallet:ActiveJettonWallet, keeper:Address, expDate:bigint, expErr:number) => Promise<SendMessageResult>;

    beforeAll(async () => {
        jwallet_code = await compile('JettonWallet');
        minter_code = await compile('JettonMinter');
        voting_code = await compile('Voting');
        vote_keeper_code = await compile('VoteKeeper');
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        notDeployer = await blockchain.treasury('notDeployer');
        defaultContent = beginCell().endCell();
        votingId = 0n;
        jettonMinter = blockchain.openContract(
                   await JettonMinter.createFromConfig(
                     {
                       admin: deployer.address,
                       content: defaultContent,
                       wallet_code: jwallet_code,
                       vote_keeper_code: vote_keeper_code,
                       voting_code: voting_code
                     },
                     minter_code));
        userWallet = async (address:Address) => blockchain.openContract(
                          JettonWallet.createFromAddress(
                            await jettonMinter.getWalletAddress(address)
                          )
                     );
        testWallet = async (address:Address) => blockchain.openContract(
                          JettonWalletTests.createFromAddress(
                            await jettonMinter.getWalletAddress(address)
                          )
                     );

        assertVoteCreation = async (via:Sender, jettonWallet:ActiveJettonWallet, voting:Address, expDate:bigint, prop:Cell, expErr:number) => {
            const minExecution   = toNano('0.5');
            const res = await jettonWallet.sendCreateVotingThroughWallet(via, expDate, minExecution, prop);

            const createVoting = {
                from: jettonWallet.address,
                on:   jettonMinter.address,
                body: JettonMinter.createVotingMessage(expDate,
                                                       minExecution,
                                                       prop)
            };

            const deployVoting = {
                from: jettonMinter.address,
                on: voting,
                deploy: true,
                success: true,
                initCode: voting_code
            };
            if(expErr == 0) {
                expect(res.transactions).toHaveTransaction(createVoting);
                expect(res.transactions).toHaveTransaction(deployVoting);
            }
            else {
                expect(res.transactions).not.toHaveTransaction(createVoting);
                expect(res.transactions).not.toHaveTransaction(deployVoting);
                expect(res.transactions).toHaveTransaction({
                    from: via.address,
                    on: jettonWallet.address,
                    success: false,
                    exitCode: expErr
                });
            }

            return res;


        }
    });

    // implementation detail
    it('should deploy', async () => {
        const deployResult = await jettonMinter.sendDeploy(deployer.getSender(), toNano('1'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            on: jettonMinter.address,
            deploy: true,
        });
    });
    // implementation detail
    it('minter admin should be able to mint jettons', async () => {
        // can mint from deployer
        let initialTotalSupply = await jettonMinter.getTotalSupply();
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = toNano('1000.23');
        const mintResult = await jettonMinter.sendMint(deployer.getSender(), deployer.address, initialJettonBalance, toNano('0.05'), toNano('1'));

        expect(mintResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            on: deployerJettonWallet.address,
            deploy: true,
        });
        expect(mintResult.transactions).toHaveTransaction({ // excesses
            from: deployerJettonWallet.address,
            on: deployer.address
        });


        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply + initialJettonBalance);
        initialTotalSupply += initialJettonBalance;
        // can mint from deployer again
        let additionalJettonBalance = toNano('2.31');
        await jettonMinter.sendMint(deployer.getSender(), deployer.address, additionalJettonBalance, toNano('0.05'), toNano('1'));
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance + additionalJettonBalance);
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply + additionalJettonBalance);
        initialTotalSupply += additionalJettonBalance;
        // can mint to other address
        let otherJettonBalance = toNano('3.12');
        await jettonMinter.sendMint(deployer.getSender(), notDeployer.address, otherJettonBalance, toNano('0.05'), toNano('1'));
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(otherJettonBalance);
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply + otherJettonBalance);
    });

    // implementation detail
    it('not a minter admin should not be able to mint jettons', async () => {
        let initialTotalSupply = await jettonMinter.getTotalSupply();
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        const unAuthMintResult = await jettonMinter.sendMint(notDeployer.getSender(), deployer.address, toNano('777'), toNano('0.05'), toNano('1'));

        expect(unAuthMintResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            on: jettonMinter.address,
            aborted: true,
            exitCode: 73, // error::unauthorized_mint_request
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply);
    });

    it('minter admin can change admin', async () => {
        expect((await jettonMinter.getAdminAddress()).equals(deployer.address)).toBe(true);
        let changeAdmin = await jettonMinter.sendChangeAdmin(deployer.getSender(), notDeployer.address);
        expect((await jettonMinter.getAdminAddress()).equals(notDeployer.address)).toBe(true);
        changeAdmin = await jettonMinter.sendChangeAdmin(notDeployer.getSender(), deployer.address);
        expect((await jettonMinter.getAdminAddress()).equals(deployer.address)).toBe(true);
    });
    it('not a minter admin can not change admin', async () => {
        let changeAdmin = await jettonMinter.sendChangeAdmin(notDeployer.getSender(), notDeployer.address);
        expect((await jettonMinter.getAdminAddress()).equals(deployer.address)).toBe(true);
        expect(changeAdmin.transactions).toHaveTransaction({
            from: notDeployer.address,
            on: jettonMinter.address,
            aborted: true,
            exitCode: 76, // error::unauthorized_change_admin_request
        });
    });

    it('minter admin can change content', async () => {
        let newContent = beginCell().storeUint(1,1).endCell();
        expect((await jettonMinter.getContent()).equals(defaultContent)).toBe(true);
        let changeContent = await jettonMinter.sendChangeContent(deployer.getSender(), newContent);
        expect((await jettonMinter.getContent()).equals(newContent)).toBe(true);
        changeContent = await jettonMinter.sendChangeContent(deployer.getSender(), defaultContent);
        expect((await jettonMinter.getContent()).equals(defaultContent)).toBe(true);
    });
    it('not a minter admin can not change content', async () => {
        let newContent = beginCell().storeUint(1,1).endCell();
        let changeContent = await jettonMinter.sendChangeContent(notDeployer.getSender(), newContent);
        expect((await jettonMinter.getContent()).equals(defaultContent)).toBe(true);
        expect(changeContent.transactions).toHaveTransaction({
            from: notDeployer.address,
            on: jettonMinter.address,
            aborted: true,
            exitCode: 77, // error::unauthorized_change_content_request
        });
    });

    it('wallet owner should be able to send jettons', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        let initialTotalSupply = await jettonMinter.getTotalSupply();
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        let initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance();
        let sentAmount = toNano('0.5');
        let forwardAmount = toNano('0.05');
        const sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), toNano('0.15'), //tons
               sentAmount, notDeployer.address,
               deployer.address, null, forwardAmount, null);
        expect(sendResult.transactions).toHaveTransaction({ //excesses
            from: notDeployerJettonWallet.address,
            on: deployer.address,
        });
        expect(sendResult.transactions).toHaveTransaction({ //notification
            from: notDeployerJettonWallet.address,
            on: notDeployer.address,
            value: forwardAmount
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance - sentAmount);
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2 + sentAmount);
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply);
    });


    it('not wallet owner should not be able to send jettons', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        let initialTotalSupply = await jettonMinter.getTotalSupply();
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        let initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance();
        let sentAmount = toNano('0.5');
        const sendResult = await deployerJettonWallet.sendTransfer(notDeployer.getSender(), toNano('0.15'), //tons
               sentAmount, notDeployer.address,
               deployer.address, null, toNano('0.05'), null);
        expect(sendResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            on: deployerJettonWallet.address,
            aborted: true,
            exitCode: 705, //error::unauthorized_transfer
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2);
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply);
    });

    it('impossible to send too much jettons', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        let initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance();
        let sentAmount = initialJettonBalance + 1n;
        let forwardAmount = toNano('0.05');
        const sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), toNano('0.15'), //tons
               sentAmount, notDeployer.address,
               deployer.address, null, forwardAmount, null);
        expect(sendResult.transactions).toHaveTransaction({
            from: deployer.address,
            on: deployerJettonWallet.address,
            aborted: true,
            exitCode: 706, //error::not_enough_jettons
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2);
    });

    it('malformed forward payload', async() => {

        const deployerJettonWallet    = await userWallet(deployer.address);
        const notDeployerJettonWallet = await userWallet(notDeployer.address);

        let sentAmount     = toNano('0.5');
        let forwardAmount  = getRandomTon(0.01, 0.05); // toNano('0.05');
        let forwardPayload = beginCell().storeUint(0x1234567890abcdefn, 128).endCell();
        let msgPayload     = beginCell().storeUint(0xf8a7ea5, 32).storeUint(0, 64) // op, queryId
                                        .storeCoins(sentAmount).storeAddress(notDeployer.address)
                                        .storeAddress(deployer.address)
                                        .storeMaybeRef(null)
                                        .storeCoins(toNano('0.05')) // No forward payload indication
                            .endCell();
        const res = await blockchain.sendMessage(internal({
                                                    from: deployer.address,
                                                    to: deployerJettonWallet.address,
                                                    body: msgPayload,
                                                    value: toNano('0.2')
                                                    }));


        expect(res.transactions).toHaveTransaction({
            from: deployer.address,
            on: deployerJettonWallet.address,
            aborted: true,
            exitCode: 708
        });
    });

    it('correctly sends forward_payload', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        let initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance();
        let sentAmount = toNano('0.5');
        let forwardAmount = toNano('0.05');
        let forwardPayload = beginCell().storeUint(0x1234567890abcdefn, 128).endCell();
        const sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), toNano('0.15'), //tons
               sentAmount, notDeployer.address,
               deployer.address, null, forwardAmount, forwardPayload);
        expect(sendResult.transactions).toHaveTransaction({ //excesses
            from: notDeployerJettonWallet.address,
            on: deployer.address,
        });
        /*
        transfer_notification#7362d09c query_id:uint64 amount:(VarUInteger 16)
                                      sender:MsgAddress forward_payload:(Either Cell ^Cell)
                                      = InternalMsgBody;
        */
        expect(sendResult.transactions).toHaveTransaction({ //notification
            from: notDeployerJettonWallet.address,
            on: notDeployer.address,
            value: forwardAmount,
            body: beginCell().storeUint(0x7362d09c, 32).storeUint(0, 64) //default queryId
                              .storeCoins(sentAmount)
                              .storeAddress(deployer.address)
                              .storeUint(1, 1)
                              .storeRef(forwardPayload)
                  .endCell()
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance - sentAmount);
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2 + sentAmount);
    });

    it('no forward_ton_amount - no forward', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        let initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance();
        let sentAmount = toNano('0.5');
        let forwardAmount = 0n;
        let forwardPayload = beginCell().storeUint(0x1234567890abcdefn, 128).endCell();
        const sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), toNano('0.15'), //tons
               sentAmount, notDeployer.address,
               deployer.address, null, forwardAmount, forwardPayload);
        expect(sendResult.transactions).toHaveTransaction({ //excesses
            from: notDeployerJettonWallet.address,
            on: deployer.address,
        });

        expect(sendResult.transactions).not.toHaveTransaction({ //no notification
            from: notDeployerJettonWallet.address,
            on: notDeployer.address
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance - sentAmount);
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2 + sentAmount);
    });

    it('check revert on not enough tons for forward', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        await deployer.send({value:toNano('1'), bounce:false, to: deployerJettonWallet.address});
        let sentAmount = toNano('0.1');
        let forwardAmount = toNano('0.3');
        let forwardPayload = beginCell().storeUint(0x1234567890abcdefn, 128).endCell();
        const sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), forwardAmount, // not enough tons, no tons for gas
               sentAmount, notDeployer.address,
               deployer.address, null, forwardAmount, forwardPayload);
        expect(sendResult.transactions).toHaveTransaction({
            from: deployer.address,
            on: deployerJettonWallet.address,
            aborted: true,
            exitCode: 709, //error::not_enough_tons
        });

        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
    });

    // implementation detail
    it('works with minimal ton amount', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        const someAddress = Address.parse("EQD__________________________________________0vo");
        const someJettonWallet = await userWallet(someAddress);
        let initialJettonBalance2 = await someJettonWallet.getJettonBalance();
        await deployer.send({value:toNano('1'), bounce:false, to: deployerJettonWallet.address});
        let forwardAmount = toNano('0.3');
        /*
                     forward_ton_amount +
                     fwd_count * fwd_fee +
                     (2 * gas_consumption + min_tons_for_storage));
        */
        let minimalFee = 2n* fwd_fee + 2n*gas_consumption + min_tons_for_storage;
        let sentAmount = forwardAmount + minimalFee; // not enough, need >
        let forwardPayload = null;
        let tonBalance =(await blockchain.getContract(deployerJettonWallet.address)).balance;
        let tonBalance2 = (await blockchain.getContract(someJettonWallet.address)).balance;
        let sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), sentAmount,
               sentAmount, someAddress,
               deployer.address, null, forwardAmount, forwardPayload);
        expect(sendResult.transactions).toHaveTransaction({
            from: deployer.address,
            on: deployerJettonWallet.address,
            aborted: true,
            exitCode: 709, //error::not_enough_tons
        });
        sentAmount += 1n; // now enough
        sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), sentAmount,
               sentAmount, someAddress,
               deployer.address, null, forwardAmount, forwardPayload);
        expect(sendResult.transactions).not.toHaveTransaction({ //no excesses
            from: someJettonWallet.address,
            on: deployer.address,
        });
        /*
        transfer_notification#7362d09c query_id:uint64 amount:(VarUInteger 16)
                                      sender:MsgAddress forward_payload:(Either Cell ^Cell)
                                      = InternalMsgBody;
        */
        expect(sendResult.transactions).toHaveTransaction({ //notification
            from: someJettonWallet.address,
            on: someAddress,
            value: forwardAmount,
            body: beginCell().storeUint(0x7362d09c, 32).storeUint(0, 64) //default queryId
                              .storeCoins(sentAmount)
                              .storeAddress(deployer.address)
                              .storeUint(0, 1)
                  .endCell()
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance - sentAmount);
        expect(await someJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2 + sentAmount);

        tonBalance =(await blockchain.getContract(deployerJettonWallet.address)).balance;
        expect((await blockchain.getContract(someJettonWallet.address)).balance).toBeGreaterThan(min_tons_for_storage);
    });

    // implementation detail
    it('wallet does not accept internal_transfer not from wallet', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
/*
  internal_transfer  query_id:uint64 amount:(VarUInteger 16) from:MsgAddress
                     response_address:MsgAddress
                     forward_ton_amount:(VarUInteger 16)
                     forward_payload:(Either Cell ^Cell)
                     = InternalMsgBody;
*/
        let internalTransfer = beginCell().storeUint(0x178d4519, 32).storeUint(0, 64) //default queryId
                              .storeCoins(toNano('0.01'))
                              .storeAddress(deployer.address)
                              .storeAddress(deployer.address)
                              .storeCoins(toNano('0.05'))
                              .storeUint(0, 1)
                  .endCell();
        const sendResult = await blockchain.sendMessage(internal({
                    from: notDeployer.address,
                    to: deployerJettonWallet.address,
                    body: internalTransfer,
                    value:toNano('0.3')
                }));
        expect(sendResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            on: deployerJettonWallet.address,
            aborted: true,
            exitCode: 707, //error::unauthorized_incoming_transfer
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
    });

    it('wallet owner should be able to burn jettons', async () => {
           const deployerJettonWallet = await userWallet(deployer.address);
            let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
            let initialTotalSupply = await jettonMinter.getTotalSupply();
            let burnAmount = toNano('0.01');
            const sendResult = await deployerJettonWallet.sendBurn(deployer.getSender(), toNano('0.1'), // ton amount
                                 burnAmount, deployer.address, null); // amount, response address, custom payload
            expect(sendResult.transactions).toHaveTransaction({ //burn notification
                from: deployerJettonWallet.address,
                on: jettonMinter.address,
                success:true
            });
            expect(sendResult.transactions).toHaveTransaction({ //message to admin
                from: jettonMinter.address,
                on: deployer.address,
                op: Op.admin.jettons_burned
            });
            expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance - burnAmount);
            expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply - burnAmount);

    });

    it('not wallet owner should not be able to burn jettons', async () => {
              const deployerJettonWallet = await userWallet(deployer.address);
              let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
              let initialTotalSupply = await jettonMinter.getTotalSupply();
              let burnAmount = toNano('0.01');
              const sendResult = await deployerJettonWallet.sendBurn(notDeployer.getSender(), toNano('0.1'), // ton amount
                                    burnAmount, deployer.address, null); // amount, response address, custom payload
              expect(sendResult.transactions).toHaveTransaction({
                 from: notDeployer.address,
                 on: deployerJettonWallet.address,
                 aborted: true,
                 exitCode: 705, //error::unauthorized_transfer
                });
              expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
              expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply);
    });

    it('wallet owner can not burn more jettons than it has', async () => {
                const deployerJettonWallet = await userWallet(deployer.address);
                let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
                let initialTotalSupply = await jettonMinter.getTotalSupply();
                let burnAmount = initialJettonBalance + 1n;
                const sendResult = await deployerJettonWallet.sendBurn(deployer.getSender(), toNano('0.1'), // ton amount
                                        burnAmount, deployer.address, null); // amount, response address, custom payload
                expect(sendResult.transactions).toHaveTransaction({
                     from: deployer.address,
                     on: deployerJettonWallet.address,
                     aborted: true,
                     exitCode: 706, //error::not_enough_jettons
                    });
                expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
                expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply);
    });

    it('minimal burn message fee', async () => {
       const deployerJettonWallet = await userWallet(deployer.address);
       let initialJettonBalance   = await deployerJettonWallet.getJettonBalance();
       let initialTotalSupply     = await jettonMinter.getTotalSupply();
       let burnAmount   = toNano('0.01');
       let fwd_fee      = 1492012n /*1500012n*/, gas_consumption = 19500000n;
       let minimalFee   = fwd_fee + 2n*gas_consumption;

       const sendLow    = await deployerJettonWallet.sendBurn(deployer.getSender(), minimalFee, // ton amount
                            burnAmount, deployer.address, null); // amount, response address, custom payload

       expect(sendLow.transactions).toHaveTransaction({
                from: deployer.address,
                on: deployerJettonWallet.address,
                aborted: true,
                exitCode: 707, //error::burn_fee_not_matched
             });

        const sendExcess = await deployerJettonWallet.sendBurn(deployer.getSender(), minimalFee + 1n,
                                                                      burnAmount, deployer.address, null);

        /*expect(sendExcess.transactions).toHaveTransaction({
            from: deployer.address,
            on: deployerJettonWallet.address,
            success: true
        });*/

        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance - burnAmount);
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply - burnAmount);

    });

    it('minter should only accept burn messages from jetton wallets', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        const burnAmount = toNano('1');
        const burnNotification = (amount: bigint, addr: Address) => {
        return beginCell()
                .storeUint(0x7bdd97de, 32)
                .storeUint(0, 64)
                .storeCoins(amount)
                .storeAddress(addr)
                .storeAddress(deployer.address)
                .storeInt(0n, 1) // no custom_payloadn
               .endCell();
        }

        let res = await blockchain.sendMessage(internal({
            from: deployerJettonWallet.address,
            to: jettonMinter.address,
            body: burnNotification(burnAmount, randomAddress(0)),
            value: toNano('0.1')
        }));

        expect(res.transactions).toHaveTransaction({
            from: deployerJettonWallet.address,
            on: jettonMinter.address,
            aborted: true,
            exitCode: 74 // Unauthorized burn
        });

        res = await blockchain.sendMessage(internal({
            from: deployerJettonWallet.address,
            to: jettonMinter.address,
            body: burnNotification(burnAmount, deployer.address),
            value: toNano('0.1')
        }));

        expect(res.transactions).toHaveTransaction({
            from: deployerJettonWallet.address,
            on: jettonMinter.address,
            success: true
        });
   });

    // TEP-89
    it('report correct discovery address', async () => {
        let discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(), deployer.address, true);
        /*
          take_wallet_address#d1735400 query_id:uint64 wallet_address:MsgAddress owner_address:(Maybe ^MsgAddress) = InternalMsgBody;
        */
        const deployerJettonWallet = await userWallet(deployer.address);
        expect(discoveryResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            on: deployer.address,
            body: beginCell().storeUint(0xd1735400, 32).storeUint(0, 64)
                              .storeAddress(deployerJettonWallet.address)
                              .storeUint(1, 1)
                              .storeRef(beginCell().storeAddress(deployer.address).endCell())
                  .endCell()
        });

        discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(), notDeployer.address, true);
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        expect(discoveryResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            on: deployer.address,
            body: beginCell().storeUint(0xd1735400, 32).storeUint(0, 64)
                              .storeAddress(notDeployerJettonWallet.address)
                              .storeUint(1, 1)
                              .storeRef(beginCell().storeAddress(notDeployer.address).endCell())
                  .endCell()
        });

        // do not include owner address
        discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(), notDeployer.address, false);
        expect(discoveryResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            on: deployer.address,
            body: beginCell().storeUint(0xd1735400, 32).storeUint(0, 64)
                              .storeAddress(notDeployerJettonWallet.address)
                              .storeUint(0, 1)
                  .endCell()
        });

    });

    it('Minimal discovery fee', async () => {
       // 5000 gas-units + msg_forward_prices.lump_price + msg_forward_prices.cell_price = 0.0061
        const fwdFee     = 1464012n;
        const minimalFee = fwdFee + 10000000n; // toNano('0.0061');

        let discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(),
                                                                      notDeployer.address,
                                                                      false,
                                                                      minimalFee);

        expect(discoveryResult.transactions).toHaveTransaction({
            from: deployer.address,
            on: jettonMinter.address,
            aborted: true,
            exitCode: 75 // discovery_fee_not_matched
        });

        /*
         * Might be helpfull to have logical OR in expect lookup
         * Because here is what is stated in standard:
         * and either throw an exception if amount of incoming value is not enough to calculate wallet address
         * or response with message (sent with mode 64)
         * https://github.com/ton-blockchain/TEPs/blob/master/text/0089-jetton-wallet-discovery.md
         * At least something like
         * expect(discoveryResult.hasTransaction({such and such}) ||
         * discoveryResult.hasTransaction({yada yada})).toBeTruethy()
         */
        discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(),
                                                           notDeployer.address,
                                                           false,
                                                           minimalFee + 1n);

        expect(discoveryResult.transactions).toHaveTransaction({
            from: deployer.address,
            on: jettonMinter.address,
            success: true
        });

    });

    it('Correctly handles not valid address in discovery', async () =>{
        const badAddr       = randomAddress(-1);
        let discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(),
                                                               badAddr,
                                                               false);

        expect(discoveryResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            on: deployer.address,
            body: beginCell().storeUint(0xd1735400, 32).storeUint(0, 64)
                             .storeUint(0, 2) // addr_none
                             .storeUint(0, 1)
                  .endCell()

        });

        // Include address should still be available

        discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(),
                                                           badAddr,
                                                           true); // Include addr

        expect(discoveryResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            on: deployer.address,
            body: beginCell().storeUint(0xd1735400, 32).storeUint(0, 64)
                             .storeUint(0, 2) // addr_none
                             .storeUint(1, 1)
                             .storeRef(beginCell().storeAddress(badAddr).endCell())
                  .endCell()

        });
    });
    // This test consume a lot of time: 18 sec
    // and is needed only for measuring ton accruing
    it('jettonWallet can process 250 transfer', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        let initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance();
        let sentAmount = 1n, count = 250n;
        let forwardAmount = toNano('0.05');
        let sendResult: any;
        let payload = beginCell()
                          .storeUint(0x12345678, 32).storeUint(0x87654321, 32)
                          .storeRef(beginCell().storeUint(0x12345678, 32).storeUint(0x87654321, 108).endCell())
                          .storeRef(beginCell().storeUint(0x12345671, 32).storeUint(0x87654321, 240).endCell())
                          .storeRef(beginCell().storeUint(0x12345672, 32).storeUint(0x87654321, 77)
                                               .storeRef(beginCell().endCell())
                                               .storeRef(beginCell().storeUint(0x1245671, 91).storeUint(0x87654321, 32).endCell())
                                               .storeRef(beginCell().storeUint(0x2245671, 180).storeUint(0x87654321, 32).endCell())
                                               .storeRef(beginCell().storeUint(0x8245671, 255).storeUint(0x87654321, 32).endCell())
                                    .endCell())
                      .endCell();
        let initialBalance =(await blockchain.getContract(deployerJettonWallet.address)).balance;
        let initialBalance2 = (await blockchain.getContract(notDeployerJettonWallet.address)).balance;
        for(let i = 0; i < count; i++) {
            sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), toNano('0.15'), //tons
                   sentAmount, notDeployer.address,
                   deployer.address, null, forwardAmount, payload);
        }
        // last chain was successful
        expect(sendResult.transactions).toHaveTransaction({ //excesses
            from: notDeployerJettonWallet.address,
            on: deployer.address,
        });
        expect(sendResult.transactions).toHaveTransaction({ //notification
            from: notDeployerJettonWallet.address,
            on: notDeployer.address,
            value: forwardAmount
        });

        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance - sentAmount*count);
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2 + sentAmount*count);

        let finalBalance =(await blockchain.getContract(deployerJettonWallet.address)).balance;
        let finalBalance2 = (await blockchain.getContract(notDeployerJettonWallet.address)).balance;

        // if it is not true, it's ok but gas_consumption constant is too high
        // and excesses of TONs will be accrued on wallet
        expect(finalBalance).toBeLessThan(initialBalance + toNano('0.001'));
        expect(finalBalance2).toBeLessThan(initialBalance2 + toNano('0.001'));
        expect(finalBalance).toBeGreaterThan(initialBalance - toNano('0.001'));
        expect(finalBalance2).toBeGreaterThan(initialBalance2 - toNano('0.001'));

    });

    // implementation detail
    it('can not send to masterchain', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let sentAmount = toNano('0.5');
        let forwardAmount = toNano('0.05');
        const sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), toNano('0.15'), //tons
               sentAmount, Address.parse("Ef8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAU"),
               deployer.address, null, forwardAmount, null);
        expect(sendResult.transactions).toHaveTransaction({ //excesses
            from: deployer.address,
            on: deployerJettonWallet.address,
            aborted: true,
            exitCode: 333 //error::wrong_workchain
        });
    });

    // implementation detail
    it('owner can withdraw excesses', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        await deployer.send({value:toNano('1'), bounce:false, to: deployerJettonWallet.address});
        let initialBalance = (await blockchain.getContract(deployer.address)).balance;
        const withdrawResult = await deployerJettonWallet.sendWithdrawTons(deployer.getSender());
        expect(withdrawResult.transactions).toHaveTransaction({ //excesses
            from: deployerJettonWallet.address,
            on: deployer.address
        });
        let finalBalance = (await blockchain.getContract(deployer.address)).balance;
        let finalWalletBalance = (await blockchain.getContract(deployerJettonWallet.address)).balance;
        expect(finalWalletBalance).toEqual(min_tons_for_storage);
        expect(finalBalance - initialBalance).toBeGreaterThan(toNano('0.99'));
    });
    // implementation detail
    it('not owner can not withdraw excesses', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        await deployer.send({value:toNano('1'), bounce:false, to: deployerJettonWallet.address});
        let initialBalance = (await blockchain.getContract(deployer.address)).balance;
        const withdrawResult = await deployerJettonWallet.sendWithdrawTons(notDeployer.getSender());
        expect(withdrawResult.transactions).not.toHaveTransaction({ //excesses
            from: deployerJettonWallet.address,
            on: deployer.address
        });
        let finalBalance = (await blockchain.getContract(deployer.address)).balance;
        let finalWalletBalance = (await blockchain.getContract(deployerJettonWallet.address)).balance;
        expect(finalWalletBalance).toBeGreaterThan(toNano('1'));
        expect(finalBalance - initialBalance).toBeLessThan(toNano('0.1'));
    });
    // implementation detail
    it('owner can withdraw jettons owned by JettonWallet', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let sentAmount = toNano('0.5');
        let forwardAmount = toNano('0.05');
        await deployerJettonWallet.sendTransfer(deployer.getSender(), toNano('0.15'), //tons
               sentAmount, deployerJettonWallet.address,
               deployer.address, null, forwardAmount, null);
        const childJettonWallet = await userWallet(deployerJettonWallet.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        let initialChildJettonBalance = await childJettonWallet.getJettonBalance();
        expect(initialChildJettonBalance).toEqual(toNano('0.5'));
        let withdrawResult = await deployerJettonWallet.sendWithdrawJettons(deployer.getSender(), childJettonWallet.address, toNano('0.4'));
        expect(await deployerJettonWallet.getJettonBalance() - initialJettonBalance).toEqual(toNano('0.4'));
        expect(await childJettonWallet.getJettonBalance()).toEqual(toNano('0.1'));
        //withdraw the rest
        await deployerJettonWallet.sendWithdrawJettons(deployer.getSender(), childJettonWallet.address, toNano('0.1'));
    });
    // implementation detail
    it('not owner can not withdraw jettons owned by JettonWallet', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let sentAmount = toNano('0.5');
        let forwardAmount = toNano('0.05');
        await deployerJettonWallet.sendTransfer(deployer.getSender(), toNano('0.15'), //tons
               sentAmount, deployerJettonWallet.address,
               deployer.address, null, forwardAmount, null);
        const childJettonWallet = await userWallet(deployerJettonWallet.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        let initialChildJettonBalance = await childJettonWallet.getJettonBalance();
        expect(initialChildJettonBalance).toEqual(toNano('0.5'));
        let withdrawResult = await deployerJettonWallet.sendWithdrawJettons(notDeployer.getSender(), childJettonWallet.address, toNano('0.4'));
        expect(await deployerJettonWallet.getJettonBalance() - initialJettonBalance).toEqual(toNano('0.0'));
        expect(await childJettonWallet.getJettonBalance()).toEqual(toNano('0.5'));
    });

    it('owner should be able to create voting via jetton wallet', async() => {
        const peasantWallet  = await userWallet(notDeployer.address); // make sure deployer status has nothing to do wiht success
        const expirationDate = getRandomExp();
        const prop           = getRandomPayload();
        const votingAddress  = await jettonMinter.getVotingAddress(votingId);
        await assertVoteCreation(notDeployer.getSender(), peasantWallet, votingAddress, expirationDate, prop, 0);
        votingId++;


    });

    it('not owner should not be able to create voting via jetton wallet', async () => {
        const jettonWallet  = await userWallet(notDeployer.address); // make sure deployer status has nothing to do wiht success
        const expirationDate = getRandomExp();
        const prop           = getRandomPayload();
        const votingAddress  = await jettonMinter.getVotingAddress(votingId);
        await assertVoteCreation(deployer.getSender(), jettonWallet, votingAddress, expirationDate, prop, 710);

    });

    it('should not be possible to create voting for too long', async() => {

        blockchain.now       = Math.floor(Date.now() / 1000); // stop ticking please
        const jettonWallet   = await userWallet(notDeployer.address);
        let   expirationDate = BigInt(blockchain.now + max_voting_duration);
        const prop           = getRandomPayload();
        const votingAddress  = await jettonMinter.getVotingAddress(votingId);
        const userSender     = notDeployer.getSender();

        await assertVoteCreation(userSender, jettonWallet, votingAddress, expirationDate, prop, 0xf10);

        // Verifying edge case works
        await assertVoteCreation(userSender, jettonWallet, votingAddress, expirationDate - 1n, prop, 0);
        votingId++;

    });

    it('should not be possible to create voting with expirationDate <= now()', async() => {

        blockchain.now       = Math.floor(Date.now() / 1000); // stop ticking please
        const jettonWallet   = await userWallet(notDeployer.address);
        let   expirationDate = BigInt(blockchain.now);
        const prop           = getRandomPayload();
        const votingAddress  = await jettonMinter.getVotingAddress(votingId);
        const userSender     = notDeployer.getSender();

        await assertVoteCreation(userSender, jettonWallet, votingAddress, expirationDate, prop, 0xf9);

        // Verifying edge case works
        await assertVoteCreation(userSender, jettonWallet, votingAddress, expirationDate + 1n, prop, 0);
        votingId++;

    });

    it('not owner should not be able to vote', async () => {

        const jettonWallet   = await userWallet(notDeployer.address);
        const expirationDate = getRandomExp();
        const prop           = getRandomPayload();
        const votingAddress = await jettonMinter.getVotingAddress(votingId++);
        let   res    = await assertVoteCreation(notDeployer.getSender(), jettonWallet, votingAddress, expirationDate, prop, 0);
        const keeper = await jettonWallet.getVoteKeeperAddress(votingAddress);

        res = await jettonWallet.sendVote(deployer.getSender(), votingAddress, expirationDate, true, false);

        expect(res.transactions).toHaveTransaction({
            from: deployer.address,
            on: jettonWallet.address,
            success:false,
            exitCode: 710
        });
        expect(res.transactions).not.toHaveTransaction({
            from: jettonWallet.address,
            on: keeper
        });
    })

    it('it should not be possible to vote with expiration date > max', async () => {

        blockchain.now       = Math.floor(Date.now() / 1000); // stop ticking please
        const jettonWallet   = await userWallet(notDeployer.address);
        let   expirationDate = getRandomExp(blockchain.now);
        const prop           = getRandomPayload();
        const votingAddress  = await jettonMinter.getVotingAddress(votingId++);
        const keeper         = await jettonWallet.getVoteKeeperAddress(votingAddress);
        let   res            = await assertVoteCreation(notDeployer.getSender(), jettonWallet, votingAddress, expirationDate, prop, 0);
        expirationDate       = BigInt(blockchain.now + max_voting_duration);

        res = await jettonWallet.sendVote(notDeployer.getSender(), votingAddress, expirationDate, true, false);


        expect(res.transactions).toHaveTransaction({
            from: notDeployer.address,
            on: jettonWallet.address,
            success:false,
            exitCode: 0xf10
        });
        expect(res.transactions).not.toHaveTransaction({
            from: jettonWallet.address,
            on: keeper
        });
        // Test edge case works
        res = await jettonWallet.sendVote(notDeployer.getSender(), votingAddress, expirationDate - 1n, true, false);
        expect(res.transactions).not.toHaveTransaction({
            from: notDeployer.address,
            on: jettonWallet.address,
            success:false,
            exitCode: 0xf10
        });
        expect(res.transactions).toHaveTransaction({
            from: jettonWallet.address,
            on: keeper
        });
 
    })

    it('it should not be possible to vote with expiration date <= now()', async () => {

        blockchain.now       = Math.floor(Date.now() / 1000); // stop ticking please
        const jettonWallet   = await userWallet(notDeployer.address);
        let   expirationDate = getRandomExp(blockchain.now);
        const prop           = getRandomPayload();
        const votingAddress  = await jettonMinter.getVotingAddress(votingId++);
        let   res            = await assertVoteCreation(notDeployer.getSender(), jettonWallet, votingAddress, expirationDate, prop, 0);
        const keeper         = await jettonWallet.getVoteKeeperAddress(votingAddress);
        expirationDate       = BigInt(blockchain.now);

        res = await jettonWallet.sendVote(notDeployer.getSender(), votingAddress, expirationDate, true, false);

        expect(res.transactions).toHaveTransaction({
            from: notDeployer.address,
            on: jettonWallet.address,
            success:false,
            exitCode: 0xf9
        });
        expect(res.transactions).not.toHaveTransaction({
            from: jettonWallet.address,
            on: keeper
        });
        // Test edge case works
        res = await jettonWallet.sendVote(notDeployer.getSender(), votingAddress, expirationDate + 1n, true, false);
        expect(res.transactions).not.toHaveTransaction({
            from: notDeployer.address,
            on: jettonWallet.address,
            success:false,
            exitCode: 0xf9
        });
        expect(res.transactions).toHaveTransaction({
            from: jettonWallet.address,
            on: keeper
        });
    });

    it('Vote confirmation request should only be allowed from minter', async () => {
        const jettonWallet = await testWallet(notDeployer.address);
        let res = await jettonWallet.sendConfirmVote(notDeployer.getSender());
        expect(res.transactions).toHaveTransaction({
            from: notDeployer.address,
            on: jettonWallet.address,
            success: false,
            exitCode: 710
        });

        res = await jettonWallet.sendConfirmVote(blockchain.sender(jettonMinter.address));
        expect(res.transactions).toHaveTransaction({
            from: jettonMinter.address,
            on: jettonWallet.address,
            success: true
        });
        expect(res.transactions).not.toHaveTransaction({
            from: notDeployer.address,
            on: jettonWallet.address,
            success: false,
            exitCode: 710
        });


    });
 
    it('Voting creation notification should only be allowed from minter', async () => {
        const jettonWallet = await testWallet(notDeployer.address);
        const voting = randomAddress();
        let res = await jettonWallet.sendVotingCreated(notDeployer.getSender(), voting);
        expect(res.transactions).toHaveTransaction({
            from: notDeployer.address,
            on: jettonWallet.address,
            success: false,
            exitCode: 710
        });

        res = await jettonWallet.sendVotingCreated(blockchain.sender(jettonMinter.address), randomAddress());
        expect(res.transactions).not.toHaveTransaction({
            from: jettonMinter.address,
            on: jettonWallet.address,
            success: false,
            exitCode: 710
        });


        expect(res.transactions).toHaveTransaction({
            from: jettonMinter.address,
            on: jettonWallet.address,
            success: true
        });
    });
 
});



