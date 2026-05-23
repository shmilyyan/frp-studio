import crypto from 'crypto'

export function generateKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
  return { publicKey, privateKey }
}

export function generateDeviceId(): string {
  return crypto.randomBytes(16).toString('hex')
}

export function generatePairingToken(): string {
  return crypto.randomBytes(4).toString('hex')
}

export function sign(privateKey: string, data: string): string {
  const signer = crypto.createSign('SHA256')
  signer.update(data)
  signer.end()
  return signer.sign(privateKey, 'base64')
}

export function verify(publicKey: string, data: string, signature: string): boolean {
  const verifier = crypto.createVerify('SHA256')
  verifier.update(data)
  verifier.end()
  return verifier.verify(publicKey, signature, 'base64')
}

export function getPublicKeyFingerprint(publicKey: string): string {
  return crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 16)
}

export function encrypt(publicKey: string, plaintext: string): string {
  return crypto.publicEncrypt(publicKey, Buffer.from(plaintext, 'utf-8')).toString('base64')
}

export function decrypt(privateKey: string, ciphertext: string): string {
  return crypto.privateDecrypt(privateKey, Buffer.from(ciphertext, 'base64')).toString('utf-8')
}
