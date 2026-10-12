// Inspect the user's decimal spelling before converting to the wire number.
// A rounded JavaScript Number must never turn sub-cent input into a valid rule.
export function parseThresholdInput(text,currency) {
  if(typeof text!=='string'||text.length>32||!/^\d+(?:\.\d{1,2})?$/.test(text)||!['CNY','USD','EUR','GBP','JPY'].includes(currency))return null
  const[whole,fraction='']=text.split('.'),cents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'))
  if(cents>2000000000000n||currency==='JPY'&&cents%100n!==0n)return null
  return Number(cents)/100
}
