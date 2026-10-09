import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
const jar = resolve(process.env.ARCFLOW_TEST_BACKEND_JAR || process.env.ARCFLOW_BACKEND_JAR || '../approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar')
const child = spawn(process.env.JAVA || 'java', ['-jar', jar], { stdio: 'inherit', env: process.env })
child.on('error', () => { console.error('Approval backend could not start. Check the Java executable and local backend jar.'); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal))
