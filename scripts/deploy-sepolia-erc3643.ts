import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import OnchainID from '@onchain-id/solidity';

async function main() {
  console.log('========================================');
  console.log('開始部署 ERC3643 到 Sepolia 測試網');
  console.log('========================================\n');

  const [deployer] = await ethers.getSigners();
  console.log('部署帳戶:', deployer.address);
  console.log('帳戶餘額:', ethers.utils.formatEther(await deployer.getBalance()), 'ETH\n');

  // Create signing keys
  const claimIssuerSigningKey = ethers.Wallet.createRandom();

  // ==================== 步驟 1: 部署實作合約 ====================
  console.log('【步驟 1/8】部署實作合約 (Implementation Contracts)...\n');

  const claimTopicsRegistryImpl = await ethers.deployContract('ClaimTopicsRegistry', deployer);
  await claimTopicsRegistryImpl.deployed();
  console.log('✓ ClaimTopicsRegistry Implementation:', claimTopicsRegistryImpl.address);

  const trustedIssuersRegistryImpl = await ethers.deployContract('TrustedIssuersRegistry', deployer);
  await trustedIssuersRegistryImpl.deployed();
  console.log('✓ TrustedIssuersRegistry Implementation:', trustedIssuersRegistryImpl.address);

  const identityRegistryStorageImpl = await ethers.deployContract('IdentityRegistryStorage', deployer);
  await identityRegistryStorageImpl.deployed();
  console.log('✓ IdentityRegistryStorage Implementation:', identityRegistryStorageImpl.address);

  const identityRegistryImpl = await ethers.deployContract('IdentityRegistry', deployer);
  await identityRegistryImpl.deployed();
  console.log('✓ IdentityRegistry Implementation:', identityRegistryImpl.address);

  const modularComplianceImpl = await ethers.deployContract('ModularCompliance', deployer);
  await modularComplianceImpl.deployed();
  console.log('✓ ModularCompliance Implementation:', modularComplianceImpl.address);

  const tokenImpl = await ethers.deployContract('Token', deployer);
  await tokenImpl.deployed();
  console.log('✓ Token Implementation:', tokenImpl.address);

  const identityImpl = await new ethers.ContractFactory(
    OnchainID.contracts.Identity.abi,
    OnchainID.contracts.Identity.bytecode,
    deployer,
  ).deploy(deployer.address, true);
  await identityImpl.deployed();
  console.log('✓ OnchainID Identity Implementation:', identityImpl.address);

  // ==================== 步驟 2: 部署 Identity 基礎設施 ====================
  console.log('\n【步驟 2/8】部署 Identity 基礎設施...\n');

  const identityImplAuthority = await new ethers.ContractFactory(
    OnchainID.contracts.ImplementationAuthority.abi,
    OnchainID.contracts.ImplementationAuthority.bytecode,
    deployer,
  ).deploy(identityImpl.address);
  await identityImplAuthority.deployed();
  console.log('✓ Identity Implementation Authority:', identityImplAuthority.address);

  const identityFactory = await new ethers.ContractFactory(
    OnchainID.contracts.Factory.abi,
    OnchainID.contracts.Factory.bytecode,
    deployer,
  ).deploy(identityImplAuthority.address);
  await identityFactory.deployed();
  console.log('✓ Identity Factory:', identityFactory.address);

  // ==================== 步驟 3: 部署 TREX 基礎設施 ====================
  console.log('\n【步驟 3/8】部署 TREX 基礎設施...\n');

  const trexImplAuthority = await ethers.deployContract(
    'TREXImplementationAuthority',
    [true, ethers.constants.AddressZero, ethers.constants.AddressZero],
    deployer,
  );
  await trexImplAuthority.deployed();
  console.log('✓ TREX Implementation Authority:', trexImplAuthority.address);

  const versionStruct = { major: 4, minor: 0, patch: 0 };
  const contractsStruct = {
    tokenImplementation: tokenImpl.address,
    ctrImplementation: claimTopicsRegistryImpl.address,
    irImplementation: identityRegistryImpl.address,
    irsImplementation: identityRegistryStorageImpl.address,
    tirImplementation: trustedIssuersRegistryImpl.address,
    mcImplementation: modularComplianceImpl.address,
  };

  const tx = await trexImplAuthority.connect(deployer).addAndUseTREXVersion(versionStruct, contractsStruct);
  await tx.wait();
  console.log('✓ TREX Version 4.0.0 已註冊');

  const trexFactory = await ethers.deployContract(
    'TREXFactory',
    [trexImplAuthority.address, identityFactory.address],
    deployer,
  );
  await trexFactory.deployed();
  console.log('✓ TREX Factory:', trexFactory.address);

  const tx2 = await identityFactory.connect(deployer).addTokenFactory(trexFactory.address);
  await tx2.wait();
  console.log('✓ Token Factory 已連結至 Identity Factory');

  // ==================== 步驟 4: 部署代理合約 ====================
  console.log('\n【步驟 4/8】部署代理合約 (Proxy Contracts)...\n');

  const ctrProxy = await ethers.deployContract('ClaimTopicsRegistryProxy', [trexImplAuthority.address], deployer);
  await ctrProxy.deployed();
  const claimTopicsRegistry = await ethers.getContractAt('ClaimTopicsRegistry', ctrProxy.address);
  console.log('✓ ClaimTopicsRegistry Proxy:', claimTopicsRegistry.address);

  const tirProxy = await ethers.deployContract('TrustedIssuersRegistryProxy', [trexImplAuthority.address], deployer);
  await tirProxy.deployed();
  const trustedIssuersRegistry = await ethers.getContractAt('TrustedIssuersRegistry', tirProxy.address);
  console.log('✓ TrustedIssuersRegistry Proxy:', trustedIssuersRegistry.address);

  const irsProxy = await ethers.deployContract('IdentityRegistryStorageProxy', [trexImplAuthority.address], deployer);
  await irsProxy.deployed();
  const identityRegistryStorage = await ethers.getContractAt('IdentityRegistryStorage', irsProxy.address);
  console.log('✓ IdentityRegistryStorage Proxy:', identityRegistryStorage.address);

  const defaultCompliance = await ethers.deployContract('DefaultCompliance', deployer);
  await defaultCompliance.deployed();
  console.log('✓ DefaultCompliance:', defaultCompliance.address);

  const irProxy = await ethers.deployContract(
    'IdentityRegistryProxy',
    [trexImplAuthority.address, trustedIssuersRegistry.address, claimTopicsRegistry.address, identityRegistryStorage.address],
    deployer,
  );
  await irProxy.deployed();
  const identityRegistry = await ethers.getContractAt('IdentityRegistry', irProxy.address);
  console.log('✓ IdentityRegistry Proxy:', identityRegistry.address);

  // ==================== 步驟 5: 部署 Token Identity ====================
  console.log('\n【步驟 5/8】部署 Token OnchainID...\n');

  const tokenIdTx = await identityFactory.connect(deployer).createIdentity(deployer.address, 'TOKEN_OID');
  const tokenIdReceipt = await tokenIdTx.wait();
  const tokenIdEvent = tokenIdReceipt.events?.find((e: any) => e.event === 'WalletLinked');
  const tokenIdentityAddr = tokenIdEvent?.args?.wallet || tokenIdEvent?.args?.[0];
  const tokenOID = await ethers.getContractAt('Identity', tokenIdentityAddr);
  console.log('✓ Token Identity:', tokenOID.address);

  // ==================== 步驟 6: 部署 Token ====================
  console.log('\n【步驟 6/8】部署 Token...\n');

  const tokenName = 'Tokenized Stock';
  const tokenSymbol = 'TSTOCK';
  const tokenDecimals = 0;

  const tokenProxy = await ethers.deployContract(
    'TokenProxy',
    [
      trexImplAuthority.address,
      identityRegistry.address,
      defaultCompliance.address,
      tokenName,
      tokenSymbol,
      tokenDecimals,
      tokenOID.address,
    ],
    deployer,
  );
  await tokenProxy.deployed();
  const token = await ethers.getContractAt('Token', tokenProxy.address);
  console.log('✓ Token:', token.address);
  console.log('  名稱:', tokenName);
  console.log('  符號:', tokenSymbol);
  console.log('  小數位:', tokenDecimals);

  // ==================== 步驟 7: 配置權限 ====================
  console.log('\n【步驟 7/8】配置權限與角色...\n');

  await (await identityRegistryStorage.connect(deployer).bindIdentityRegistry(identityRegistry.address)).wait();
  console.log('✓ Identity Registry 已綁定至 Storage');

  await (await token.connect(deployer).addAgent(deployer.address)).wait();
  console.log('✓ Deployer 已設為 Token Agent');

  await (await identityRegistry.connect(deployer).addAgent(deployer.address)).wait();
  await (await identityRegistry.connect(deployer).addAgent(token.address)).wait();
  console.log('✓ Agents 已加入 Identity Registry');

  // ==================== 步驟 8: 設置 Claims 系統 ====================
  console.log('\n【步驟 8/8】設置 Claims 系統...\n');

  const claimTopics = [ethers.utils.id('CLAIM_TOPIC')];
  await (await claimTopicsRegistry.connect(deployer).addClaimTopic(claimTopics[0])).wait();
  console.log('✓ Claim Topic 已加入:', claimTopics[0]);

  const claimIssuerContract = await ethers.deployContract('ClaimIssuer', [deployer.address], deployer);
  await claimIssuerContract.deployed();
  console.log('✓ Claim Issuer Contract:', claimIssuerContract.address);

  const keyHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(['address'], [claimIssuerSigningKey.address])
  );
  await (await claimIssuerContract.connect(deployer).addKey(keyHash, 3, 1)).wait();
  console.log('✓ Claim Signing Key 已加入');

  await (await trustedIssuersRegistry.connect(deployer).addTrustedIssuer(claimIssuerContract.address, claimTopics)).wait();
  console.log('✓ Claim Issuer 已設為 Trusted Issuer');

  await (await token.connect(deployer).unpause()).wait();
  console.log('✓ Token 已解除暫停\n');

  // ==================== 部署完成 ====================
  console.log('\n========================================');
  console.log('🎉 部署完成！');
  console.log('========================================\n');

  console.log('【主要合約地址】');
  console.log('Token (ERC3643):              ', token.address);
  console.log('Identity Registry:            ', identityRegistry.address);
  console.log('Identity Registry Storage:    ', identityRegistryStorage.address);
  console.log('Claim Topics Registry:        ', claimTopicsRegistry.address);
  console.log('Trusted Issuers Registry:     ', trustedIssuersRegistry.address);
  console.log('Default Compliance:           ', defaultCompliance.address);
  console.log('Token OnchainID:              ', tokenOID.address);
  console.log('Claim Issuer Contract:        ', claimIssuerContract.address);

  console.log('\n【實作合約地址】');
  console.log('Token Implementation:                     ', tokenImpl.address);
  console.log('Identity Registry Implementation:         ', identityRegistryImpl.address);
  console.log('Identity Registry Storage Implementation: ', identityRegistryStorageImpl.address);
  console.log('Claim Topics Registry Implementation:     ', claimTopicsRegistryImpl.address);
  console.log('Trusted Issuers Registry Implementation:  ', trustedIssuersRegistryImpl.address);
  console.log('Modular Compliance Implementation:        ', modularComplianceImpl.address);
  console.log('OnchainID Identity Implementation:        ', identityImpl.address);

  console.log('\n【工廠與權限合約】');
  console.log('TREX Implementation Authority:     ', trexImplAuthority.address);
  console.log('Identity Implementation Authority: ', identityImplAuthority.address);
  console.log('TREX Factory:                      ', trexFactory.address);
  console.log('Identity Factory:                  ', identityFactory.address);

  console.log('\n【重要資訊】');
  console.log('Deployer (Token Agent):        ', deployer.address);
  console.log('Claim Issuer Signing Key:      ', claimIssuerSigningKey.address);
  console.log('Claim Issuer Private Key:      ', claimIssuerSigningKey.privateKey);
  console.log('⚠️  請妥善保存 Claim Issuer Private Key！');

  console.log('\n========================================');
  console.log('請保存以上所有地址和私鑰');
  console.log('========================================\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ 部署失敗:');
    console.error(error);
    process.exit(1);
  });
