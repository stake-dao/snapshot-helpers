import SafeApiKit from "@safe-global/api-kit";
import Safe from "@safe-global/protocol-kit";
import { MetaTransactionData } from "@safe-global/types-kit";
import { JsonRpcProvider } from "@ethersproject/providers";
import { Address } from "viem";
import { Wallet } from "ethers";
import { simulateOnTenderly } from "./tenderly-simulator";

export interface SafeConfig {
  rpcUrl: string;
  safeAddress: string;
  chainId: bigint;
}

export interface ProposerConfig {
  privateKey: string;
}

export interface TenderlyConfig {
  accessKey: string;
  user: string;
  project: string;
}

interface SafeTransactionResult {
  txHash: string;
  transaction: any;
  url: string;
}

export class SafeTransactionHelper {
  private provider: JsonRpcProvider;
  private signer: Wallet;
  private apiKit: SafeApiKit;
  private protocolKit: Safe;

  constructor(
    private safeConfig: SafeConfig,
    private proposerConfig: ProposerConfig
  ) { }

  async init() {
    this.provider = new JsonRpcProvider(this.safeConfig.rpcUrl);
    this.signer = new Wallet(
      this.proposerConfig.privateKey,
      this.provider
    );

    this.apiKit = new SafeApiKit({
      chainId: this.safeConfig.chainId,
    });

    this.protocolKit = await Safe.init({
      provider: this.safeConfig.rpcUrl,
      signer: this.proposerConfig.privateKey,
      safeAddress: this.safeConfig.safeAddress,
    });
  }

  private getNetworkPrefix(): string {
    switch (this.safeConfig.chainId) {
      case 1n:
        return "eth";
      case 42161n:
        return "arb1";
      case 137n:
        return "matic";
      case 56n:
        return "bnb";
      default:
        return `chain${this.safeConfig.chainId}`;
    }
  }

  private generateSafeUrl(txHash: string): string {
    const networkPrefix = this.getNetworkPrefix();
    const safeAddress = this.safeConfig.safeAddress.toLowerCase();
    return `https://app.safe.global/transactions/tx?id=multisig_${safeAddress}_${txHash}&safe=${networkPrefix}:${safeAddress}`;
  }

  async proposeTransactions(
    txDatas: MetaTransactionData[],
  ): Promise<SafeTransactionResult> {
    const safeTransaction = await this.protocolKit.createTransaction({
      transactions: txDatas,
    });
    const safeTxHash =
      await this.protocolKit.getTransactionHash(safeTransaction);
    const senderAddress = await this.signer.getAddress();

    await this.apiKit.proposeTransaction({
      safeAddress: this.safeConfig.safeAddress,
      safeTransactionData: safeTransaction.data,
      safeTxHash,
      senderAddress,
      senderSignature: null
    });

    return {
      txHash: safeTxHash,
      transaction: safeTransaction,
      url: this.generateSafeUrl(safeTxHash),
    };
  }

  async simulateTransactions(
    txDatas: MetaTransactionData[],
    tenderlyConfig: TenderlyConfig,
  ) {
    if (!tenderlyConfig) {
      throw new Error("Tenderly config required for simulation");
    }

    const simulationUrls: string[] = [];
    for (const txData of txDatas) {
      const simulationUrl = await simulateOnTenderly(tenderlyConfig, {
        chainId: Number(this.safeConfig.chainId),
        from: this.safeConfig.safeAddress as Address,
        to: txData.to as Address,
        input: txData.data,
        value: txData.value,
      });
      simulationUrls.push(simulationUrl);
    }

    return {
      simulation: true,
      urls: simulationUrls,
    };
  }
}
