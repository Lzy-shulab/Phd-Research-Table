import { execFile } from 'node:child_process'
import { cpolarSshHost } from '../../domain/cpolar-ssh'

// Reuse the running collector's program/config, without reading its credentials
// into the desktop process or changing the collector's task history.
const collect = `import json,pathlib,subprocess,sys
pid=subprocess.check_output(['systemctl','--user','show','gpu-monitor.service','--value','-p','MainPID'],text=True).strip()
args=pathlib.Path('/proc/'+pid+'/cmdline').read_bytes().decode().strip('\\0').split('\\0')
program=next(arg for arg in args if arg.endswith('/collector.py'))
config=args[args.index('--config')+1]
result=subprocess.run([sys.executable,program,'--config',config,'--dry-run'],capture_output=True,text=True,timeout=20,check=True)
snapshot=json.loads(result.stdout)
print(json.dumps(snapshot,ensure_ascii=False))
`

export function collectRemoteGpu(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = execFile(process.platform === 'win32' ? 'ssh.exe' : 'ssh',
      ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', cpolarSshHost, 'python3', '-'],
      { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
        if (error) {
          const message = error.code === 'ENOENT' ? '未找到 SSH 客户端，请安装 OpenSSH 后重试。'
            : /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(stderr)
              ? 'SSH 主机密钥验证失败，请先确认 YunBensheng 的服务器身份后重试。'
            : /Permission denied|Authentication failed/i.test(stderr) ? 'SSH 身份验证失败，请检查 YunBensheng 的登录密钥。'
            : error.killed || /timed out|TimeoutExpired/i.test(stderr) ? '实时采集超时，请检查 SSH 连接和远端采集服务后重试。'
            : error.code === 255 ? 'SSH 连接失败，请刷新 Cpolar 地址后重试。'
            : '远端 GPU 采集失败，请检查 gpu-monitor 服务后重试。'
          reject(new Error(message)); return
        }
        try { resolve(JSON.parse(stdout)) }
        catch { reject(new Error('远端未返回有效的本次 GPU 采集结果。')) }
      })
    child.stdin?.on('error', () => {})
    child.stdin?.end(collect)
  })
}
