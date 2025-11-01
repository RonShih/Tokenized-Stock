import { ethers } from 'hardhat';
import OnchainID from '@onchain-id/solidity';

/**
 * 正確的步驟順序（參考 deploy-full-suite.fixture.ts）：
 * 1. 創建 OnchainID
 * 2. 註冊身份到 IdentityRegistry (先註冊!)
 * 3. 添加 Claims (後添加 Claims!)
 * 4. 驗證身份
 * 5. Mint tokens
 * 6. 轉帳測試
 * 7. 回收 ETH
 */

async function main() {
  console.log('\n========================================');
  console.log('測試 Alice 和 Bob 的身份與轉帳');
  console.log('========================================\n');

  // ==================== 配置 ====================
  const DEPLOYED_ADDRESSES = {
    token: '0xBEae6Fa62362aB593B498692FD09002a9eEd52dc',
    identityRegistry: '0xF2a0227754b62AD3719780F79BA034c871c873f0',
    identityImplementationAuthority: '0x187eDAc6D0C7E9f7162FD469F5dDAD000910c9D4', // 從部署輸出複製
    claimIssuerContract: '0x6cb335F1Bb7CEA9FD0e1cfC44C816A444717166b',
    claimTopics: ['0x2e8e9dbac879b1e3204f60b5b07c03c463be5f75a01ec30831bc754da79e4bf5'],
    claimIssuerSigningPrivateKey: '0xa052bad8355b9c6ebe5c810d388565b207b97efe9bcba54170143772a8bd85e6',
  };

  const [deployer] = await ethers.getSigners();
  const alice = ethers.Wallet.createRandom().connect(ethers.provider);
  const bob = ethers.Wallet.createRandom().connect(ethers.provider);

  console.log('Deployer:', deployer.address);
  console.log('Deployer Balance:', ethers.utils.formatEther(await deployer.getBalance()), 'ETH');
  console.log('Alice:', alice.address);
  console.log('Bob:', bob.address);
  console.log('');

  // 連接合約
  const token = await ethers.getContractAt('Token', DEPLOYED_ADDRESSES.token);
  const identityRegistry = await ethers.getContractAt('IdentityRegistry', DEPLOYED_ADDRESSES.identityRegistry);
  const claimIssuerContract = await ethers.getContractAt('ClaimIssuer', DEPLOYED_ADDRESSES.claimIssuerContract);
  const claimIssuerSigningKey = new ethers.Wallet(DEPLOYED_ADDRESSES.claimIssuerSigningPrivateKey);

  // ==================== 發送測試幣 ====================
  console.log('💰 從 Deployer 發送測試幣...\n');
  const fundAmount = ethers.utils.parseEther('0.001');

  await (await deployer.sendTransaction({ to: alice.address, value: fundAmount })).wait();
  console.log('✓ 已發送', ethers.utils.formatEther(fundAmount), 'ETH 給 Alice');

  await (await deployer.sendTransaction({ to: bob.address, value: fundAmount })).wait();
  console.log('✓ 已發送', ethers.utils.formatEther(fundAmount), 'ETH 給 Bob\n');

  // ==================== 步驟 1: 創建 OnchainID (直接部署 IdentityProxy) ====================
  console.log('【步驟 1/7】創建 OnchainID (直接部署 IdentityProxy)...\n');

  // 部署 Alice 的 IdentityProxy
  const aliceIdentityProxy = await new ethers.ContractFactory(
    OnchainID.contracts.IdentityProxy.abi,
    OnchainID.contracts.IdentityProxy.bytecode,
    deployer
  ).deploy(DEPLOYED_ADDRESSES.identityImplementationAuthority, alice.address);
  await aliceIdentityProxy.deployed();
  const aliceIdentity = await ethers.getContractAt('Identity', aliceIdentityProxy.address);
  console.log('✓ Alice Identity:', aliceIdentity.address);

  // 部署 Bob 的 IdentityProxy
  const bobIdentityProxy = await new ethers.ContractFactory(
    OnchainID.contracts.IdentityProxy.abi,
    OnchainID.contracts.IdentityProxy.bytecode,
    deployer
  ).deploy(DEPLOYED_ADDRESSES.identityImplementationAuthority, bob.address);
  await bobIdentityProxy.deployed();
  const bobIdentity = await ethers.getContractAt('Identity', bobIdentityProxy.address);
  console.log('✓ Bob Identity:', bobIdentity.address);

  // ==================== 步驟 2: 註冊到 IdentityRegistry ====================
  console.log('\n【步驟 2/7】註冊身份到 IdentityRegistry (在添加 Claim 之前)...\n');

  await (
    await identityRegistry
      .connect(deployer)
      .batchRegisterIdentity(
        [alice.address, bob.address],
        [aliceIdentity.address, bobIdentity.address],
        [840, 840]
      )
  ).wait();
  console.log('✓ Alice 和 Bob 已註冊 (Country: 840 - USA)');

  // ==================== 步驟 3: 為 Alice 添加 Claim ====================
  console.log('\n【步驟 3/7】為 Alice 簽發並添加 Claim...\n');

  const claimForAlice = {
    data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('Alice KYC verified')),
    issuer: claimIssuerContract.address,
    topic: DEPLOYED_ADDRESSES.claimTopics[0],
    scheme: 1,
    identity: aliceIdentity.address,
    signature: '',
  };

  claimForAlice.signature = await claimIssuerSigningKey.signMessage(
    ethers.utils.arrayify(
      ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint256', 'bytes'],
          [claimForAlice.identity, claimForAlice.topic, claimForAlice.data]
        )
      )
    )
  );

  await (
    await aliceIdentity
      .connect(alice)
      .addClaim(
        claimForAlice.topic,
        claimForAlice.scheme,
        claimForAlice.issuer,
        claimForAlice.signature,
        claimForAlice.data,
        ''
      )
  ).wait();
  console.log('✓ Alice Claim 已添加');

  // ==================== 步驟 4: 為 Bob 添加 Claim ====================
  console.log('\n【步驟 4/7】為 Bob 簽發並添加 Claim...\n');

  const claimForBob = {
    data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('Bob KYC verified')),
    issuer: claimIssuerContract.address,
    topic: DEPLOYED_ADDRESSES.claimTopics[0],
    scheme: 1,
    identity: bobIdentity.address,
    signature: '',
  };

  claimForBob.signature = await claimIssuerSigningKey.signMessage(
    ethers.utils.arrayify(
      ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint256', 'bytes'],
          [claimForBob.identity, claimForBob.topic, claimForBob.data]
        )
      )
    )
  );

  await (
    await bobIdentity
      .connect(bob)
      .addClaim(claimForBob.topic, claimForBob.scheme, claimForBob.issuer, claimForBob.signature, claimForBob.data, '')
  ).wait();
  console.log('✓ Bob Claim 已添加');

  // ==================== 步驟 5: 驗證身份 ====================
  console.log('\n【步驟 5/7】驗證身份...\n');

  const aliceVerified = await identityRegistry.isVerified(alice.address);
  const bobVerified = await identityRegistry.isVerified(bob.address);
  console.log('Alice verified:', aliceVerified);
  console.log('Bob verified:', bobVerified);

  // ==================== 步驟 6: Mint 和轉帳 ====================
  console.log('\n【步驟 6/7】Mint 給 Alice 並測試轉帳...\n');

  await (await token.connect(deployer).mint(alice.address, 1000)).wait();
  console.log('✓ Minted 1000 tokens 給 Alice');

  await (await token.connect(alice).transfer(bob.address, 300)).wait();
  console.log('✓ Alice 轉帳 300 tokens 給 Bob');

  console.log('\n最終 Token 餘額:');
  console.log('  Alice:', (await token.balanceOf(alice.address)).toString());
  console.log('  Bob:', (await token.balanceOf(bob.address)).toString());


  console.log('\n========================================');
  console.log('🎉 測試完成！');
  console.log('========================================\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ 測試失敗:');
    console.error(error);
    process.exit(1);
  });
