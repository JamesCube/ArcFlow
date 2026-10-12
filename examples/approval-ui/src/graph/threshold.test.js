import{describe,it,expect}from'vitest'
import{parseThresholdInput}from'./threshold.js'
describe('graph condition text boundary',()=>{
 it('validates decimal spelling before any floating point coercion',()=>{for(const value of ['19999999999.999999','10000.00000000000001','1.001','1e4','','.1','NaN','-1','20000000000.01'])expect(parseThresholdInput(value,'CNY')).toBeNull();expect(parseThresholdInput('20000000000.00','CNY')).toBe(20000000000);expect(parseThresholdInput('10000.01','CNY')).toBe(10000.01);expect(parseThresholdInput('0','CNY')).toBe(0)})
 it('requires whole yen and known currencies',()=>{expect(parseThresholdInput('1.01','JPY')).toBeNull();expect(parseThresholdInput('1.00','JPY')).toBe(1);expect(parseThresholdInput('1','BAD')).toBeNull()})
})
