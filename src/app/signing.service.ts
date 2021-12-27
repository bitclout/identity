import { Injectable } from '@angular/core';
import KeyEncoder from 'key-encoder';
import * as jsonwebtoken from 'jsonwebtoken';
import * as ecies from '../lib/ecies';
import {CryptoService} from './crypto.service';
import {GlobalVarsService} from "./global-vars.service";
import * as sha256 from 'sha256';
import { uvarint64ToBuf } from '../lib/bindata/util';
import {decryptShared} from '../lib/ecies';
import {ec as EC} from "elliptic";
import {EncryptedMessage, PartyMessagingKeys} from "../types/identity";

@Injectable({
  providedIn: 'root'
})
export class SigningService {

  constructor(
    private cryptoService: CryptoService,
    private globalVars: GlobalVarsService,
  ) { }

  signJWT(seedHex: string): string {
    const keyEncoder = new KeyEncoder('secp256k1');
    const encodedPrivateKey = keyEncoder.encodePrivate(seedHex, 'raw', 'pem');
    return jsonwebtoken.sign({ }, encodedPrivateKey, { algorithm: 'ES256', expiresIn: 60 * 10 });
  }

  encryptMessage(seedHex: string, recipientPublicKey: string, partyKeys: PartyMessagingKeys, message: string): any {
    const ec = new EC('secp256k1');
    const privateKey = this.cryptoService.seedHexToPrivateKey(seedHex);
    const privateKeyBuffer = privateKey.getPrivate().toBuffer(undefined,32);
    const publicKeyBuffer = this.cryptoService.publicKeyToECBuffer(recipientPublicKey);

    // If we've failed fetching partyKeys for whatever reason, we return.
    if(JSON.stringify(partyKeys) === JSON.stringify({})){
      console.error("Failed fetching party entry.")
      return {
        encryptedMessage: "",
        messagingParty: {}
      };
    }

    try {
      // If sender (the user) have authorized the default messaging key, then we would compute it and use for encryption.
      let privateEncryptionKey = privateKeyBuffer;
      if(partyKeys.isSenderMessagingKey){
        privateEncryptionKey = this.cryptoService.deriveMessagingKey(seedHex, this.globalVars.defaultMessageKeyName);
      }
      // If recipient has authorized a default messaging key, then we would use it for the encryption.
      let publicEncryptionKey = publicKeyBuffer;
      if(partyKeys.isRecipientMessagingKey){
        publicEncryptionKey = new Buffer(ec.keyFromPublic(partyKeys.recipientMessagingPublicKey, 'hex').getPublic('array'));
      }

      // Encrypt the message using keys we determined above.
      const encryptedMessage = ecies.encryptShared(privateEncryptionKey, publicEncryptionKey, message);
      return {
        encryptedMessage: encryptedMessage.toString('hex'),
        messagingParty: partyKeys
      };
    } catch (e) {
      console.error(e);
      return {
        encryptedMessage: "",
        messagingParty: {}
      };
    }
  }

  // Legacy decryption for older clients
  // @param encryptedHexes : string[]
  decryptMessagesLegacy(seedHex: string, encryptedHexes: any): { [key: string]: any } {
    const privateKey = this.cryptoService.seedHexToPrivateKey(seedHex);
    const privateKeyBuffer = privateKey.getPrivate().toBuffer(undefined,32);

    const decryptedHexes: { [key: string]: any } = {};
    for (const encryptedHex of encryptedHexes) {
      const encryptedBytes = new Buffer(encryptedHex, 'hex');
      const opts = {legacy: true};
      try {
        decryptedHexes[encryptedHex] = ecies.decrypt(privateKeyBuffer, encryptedBytes, opts).toString();
      } catch (e){
        console.error(e);
      }
    }
    return decryptedHexes;
  }

  // Decrypt messages encrypted with shared secret
  decryptMessages(seedHex: string, encryptedMessages: EncryptedMessage[]): { [key: string]: any } {
    const privateKey = this.cryptoService.seedHexToPrivateKey(seedHex);
    const privateKeyBuffer = privateKey.getPrivate().toBuffer(undefined, 32);
    const ec = new EC('secp256k1');

    const decryptedHexes: { [key: string]: any } = {};
    for (const encryptedMessage of encryptedMessages) {
      const publicKey = encryptedMessage.PublicKey;
      const publicKeyBytes = this.cryptoService.publicKeyToECBuffer(publicKey);
      const encryptedBytes = new Buffer(encryptedMessage.EncryptedHex, 'hex');
      // Check if message was encrypted using shared secret or public key method
      if (encryptedMessage.Legacy) {
        // If message was encrypted using public key, check the sender to determine if message is decryptable.
        try {
          if (!encryptedMessage.IsSender) {
            const opts = {legacy: true};
            decryptedHexes[encryptedMessage.EncryptedHex] = ecies.decrypt(privateKeyBuffer, encryptedBytes, opts).toString();
          } else {
            decryptedHexes[encryptedMessage.EncryptedHex] = '';
          }
        } catch (e) {
          console.error(e);
        }
      } else if(!encryptedMessage.Version) {
        try {
          decryptedHexes[encryptedMessage.EncryptedHex] = ecies.decryptShared(privateKeyBuffer, publicKeyBytes, encryptedBytes).toString();
        } catch (e) {
          console.error(e);
        }
      } else {
        // DeSo V3 Messages
        try {
          // V3 messages will have Legacy=false and Version=3.
          if(encryptedMessage.Version && encryptedMessage.Version === 3){
            let privateEncryptionKey = privateKeyBuffer;
            let publicEncryptionKey = publicKeyBytes;
            let defaultKey = false;

            // The DeSo V3 Messages rotating public keys are computed using trapdoor key derivation. To find the
            // private key of a messaging public key, we just need the trapdoor = user's seedHex and the key name.
            // Setting IsSender tells Identity if it should invert sender or recipient public key.
            if(encryptedMessage.IsSender) {
              if(encryptedMessage.SenderMessagingKeyName === this.globalVars.defaultMessageKeyName)
                defaultKey = true;
              publicEncryptionKey = new Buffer(ec.keyFromPublic(encryptedMessage.RecipientMessagingPublicKey as string, 'hex').getPublic('array'));
            } else {
              if(encryptedMessage.RecipientMessagingKeyName === this.globalVars.defaultMessageKeyName)
                defaultKey = true;
              publicEncryptionKey = new Buffer(ec.keyFromPublic(encryptedMessage.SenderMessagingPublicKey as string, 'hex').getPublic('array'));
            }

            // Currently, Identity only computes trapdoor public key with name "default-key".
            // Compute messaging private key as kdf( sha256x2( sha256x2(secret key) || sha256x2(key name) ) )
            if (defaultKey) {
              privateEncryptionKey = this.cryptoService.deriveMessagingKey(seedHex, this.globalVars.defaultMessageKeyName);
            }

            // Now decrypt the message based on computed keys.
            decryptedHexes[encryptedMessage.EncryptedHex] = ecies.decryptShared(privateEncryptionKey, publicEncryptionKey, encryptedBytes).toString();
          }
        } catch(e) {
          console.error(e);
        }
      }
    }
    return decryptedHexes;
  }

  signTransaction(seedHex: string, transactionHex: string): string {
    const privateKey = this.cryptoService.seedHexToPrivateKey(seedHex);

    const transactionBytes = new Buffer(transactionHex, 'hex');
    const transactionHash = new Buffer(sha256.x2(transactionBytes), 'hex');
    const signature = privateKey.sign(transactionHash);
    const signatureBytes = new Buffer(signature.toDER());
    const signatureLength = uvarint64ToBuf(signatureBytes.length);

    const signedTransactionBytes = Buffer.concat([
      // This slice is bad. We need to remove the existing signature length field prior to appending the new one.
      // Once we have frontend transaction construction we won't need to do this.
      transactionBytes.slice(0, -1),
      signatureLength,
      signatureBytes,
    ]);

    return signedTransactionBytes.toString('hex');
  }

  signHashes(seedHex: string, unsignedHashes: string[]): string[] {
    const privateKey = this.cryptoService.seedHexToPrivateKey(seedHex);
    const signedHashes = [];

    for (const unsignedHash of unsignedHashes) {
      const signature = privateKey.sign(unsignedHash);
      const signatureBytes = new Buffer(signature.toDER());
      signedHashes.push(signatureBytes.toString('hex'));
    }

    return signedHashes;
  }

  signHashesETH(seedHex: string, unsignedHashes: string[]): {s: any, r: any, v: number | null}[] {
    const privateKey = this.cryptoService.seedHexToPrivateKey(seedHex);
    const signedHashes = [];

    for (const unsignedHash of unsignedHashes) {
      const signature = privateKey.sign(unsignedHash, { canonical: true });

      signedHashes.push({
        s: "0x" + signature.s.toString("hex"),
        r: "0x" + signature.r.toString("hex"),
        v: signature.recoveryParam
      });
    }

    return signedHashes;
  }
}
