import {
  bytesToHexString,
  createDidPkhUri,
  createJwtSigner,
  curveToJwtAlgorithm,
  generateKeypair,
  hexStringToBytes,
} from 'agentcommercekit'
import { publicKeyToAddress } from 'viem/utils'

export async function getIdentityFromPrivateKeyHex(privateKeyHex: string) {
  const keypair = await generateKeypair('secp256k1', hexStringToBytes(privateKeyHex))
  const address = publicKeyToAddress(`0x${bytesToHexString(keypair.publicKey)}`)
  const did = createDidPkhUri('eip155:84532', address)
  const signer = createJwtSigner(keypair)
  const alg = curveToJwtAlgorithm('secp256k1')
  return { did, signer, alg }
}
