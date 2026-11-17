"""Publish the source and the three Windows release assets without persisting credentials."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.parse

workspace = Path(__file__).resolve().parent.parent
version = json.loads((workspace / 'package.json').read_text(encoding='utf-8-sig'))['version']
repository = 'Lzy-shulab/Phd-Research-Table'
evidence = workspace / 'test-results' / f'fixes-{version}' / 'publish'
evidence.mkdir(parents=True, exist_ok=True)
checkout = evidence / 'repo'
credential = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n', text=True, capture_output=True, check=True)
credential_fields = dict(line.split('=', 1) for line in credential.stdout.splitlines() if '=' in line)
token = credential_fields.get('password')
if not token:
    raise RuntimeError('GitHub credential helper returned no credential')
proxy_url = os.environ.get('WORKBENCH_PUBLISH_PROXY', '')
headers = {'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json', 'User-Agent': 'PhD-Workbench-Publisher', 'X-GitHub-Api-Version': '2022-11-28'}

def run_curl(args):
    if os.name == 'nt':
        args += ['--ssl-revoke-best-effort']
    config = '\n'.join(f'header = "{key}: {value}"' for key, value in headers.items())
    for attempt in range(5):
        response = subprocess.run(args, input=config.encode('utf-8'), capture_output=True)
        response.stdout = response.stdout.decode('utf-8', errors='replace')
        response.stderr = response.stderr.decode('gb18030' if os.name == 'nt' else 'utf-8', errors='replace')
        # These failures happen before an HTTP request can reach GitHub.
        if response.returncode not in {6, 7, 35} or attempt == 4:
            return response
        time.sleep(1)

def api(path, method='GET', body=None):
    url = f'https://api.github.com/repos/{repository}/{path}'.rstrip('/')
    args = ['curl.exe', '--config', '-', '--silent', '--show-error', '--fail', '--http1.1', '--tlsv1.2', '--tls-max', '1.2', '--max-time', '60', '--request', method]
    if proxy_url:
        args += ['--proxy', proxy_url]
    else:
        args += ['--noproxy', '*']
    if method == 'GET':
        args += ['--retry', '2']
    args += ['--header', 'Content-Type: application/json', url]
    if body is not None:
        body_path = evidence / 'github-request-body.json'
        body_path.write_text(json.dumps(body, ensure_ascii=False), encoding='utf-8')
        args += ['--data-binary', f'@{body_path}']
    response = run_curl(args)
    if response.returncode:
        raise RuntimeError(f'GitHub API request failed: {response.stderr.strip()}')
    return json.loads(response.stdout) if response.stdout.strip() else None

def inspect():
    repo = api('')
    latest = api('releases/latest')
    print(json.dumps({'repository': repo['full_name'], 'branch': repo['default_branch'], 'latest': latest['tag_name'], 'assets': [asset['name'] for asset in latest['assets']]}, ensure_ascii=False))

def sync():
    if not (checkout / '.git').exists():
        raise RuntimeError('Create a clean source checkout before publishing')
    excluded = {'node_modules', 'out', 'release', 'test-results', 'delete', 'tmp', '工作台数据', '.git'}
    files = []
    for root, directories, names in os.walk(workspace):
        directories[:] = [name for name in directories if name not in excluded and not name.startswith('release-stage-')]
        for name in names:
            path = Path(root) / name
            if name.startswith('.env') and name != '.env.example':
                continue
            if path.suffix.lower() in {'.sqlite', '.db', '.log'} or '.sqlite-' in name or '.db-' in name:
                continue
            relative = path.relative_to(workspace)
            target = checkout / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
            if target.read_bytes() != path.read_bytes():
                raise RuntimeError(f'Source content mismatch: {relative}')
            files.append(relative.as_posix())
    tracked = subprocess.run(['git', 'ls-files', '-z'], cwd=checkout, capture_output=True, check=True).stdout.decode().split('\0')
    for name in tracked:
        if name and name not in files and (checkout / name).exists():
            archived = evidence / 'removed-source' / name
            archived.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(checkout / name), archived)
    with (evidence / 'git.log').open('a', encoding='utf-8') as log:
        for args in [['git', 'add', '-A'], ['git', 'commit', '-m', f'Fix packaged runtime dependencies for v{version}'],
                     ['git', '-c', 'http.proxy=', '-c', 'https.proxy=', 'push', 'origin', 'main']]:
            subprocess.run(args, cwd=checkout, stdout=log, stderr=log, check=True)
    print(f'SOURCE_PUSHED files={len(files)} version={version}')

def sync_api():
    if not (checkout / '.git').exists():
        raise RuntimeError('Create a clean source checkout before publishing')
    head = api('git/ref/heads/main')['object']['sha']
    remote_commit = api(f'git/commits/{head}')
    base_tree = remote_commit['tree']['sha']
    local_base_tree = subprocess.run(['git', 'rev-parse', 'origin/main^{tree}'], cwd=checkout, text=True, capture_output=True, check=True).stdout.strip()
    if base_tree != local_base_tree:
        raise RuntimeError('Remote source changed after the release checkout was prepared')
    changes = subprocess.run(['git', 'diff', '--name-status', 'origin/main..main'], cwd=checkout, text=True, capture_output=True, check=True).stdout.splitlines()
    elements = []
    import base64
    for line in changes:
        status, path = line.split('\t', 1)
        if status == 'D':
            elements.append({'path': path, 'mode': '100644', 'type': 'blob', 'sha': None})
            continue
        if status not in {'A', 'M'}:
            raise RuntimeError(f'Unsupported source change: {status} {path}')
        source = checkout / path
        mode_line = subprocess.run(['git', 'ls-files', '-s', '--', path], cwd=checkout, text=True, capture_output=True, check=True).stdout
        mode = mode_line.split(' ', 1)[0] or '100644'
        blob = api('git/blobs', 'POST', {'content': base64.b64encode(source.read_bytes()).decode('ascii'), 'encoding': 'base64'})
        elements.append({'path': path, 'mode': mode, 'type': 'blob', 'sha': blob['sha']})
    tree = api('git/trees', 'POST', {'base_tree': base_tree, 'tree': elements})
    commit = api('git/commits', 'POST', {'message': f'Fix packaged runtime dependencies for v{version}', 'tree': tree['sha'], 'parents': [head]})
    api('git/refs/heads/main', 'PATCH', {'sha': commit['sha'], 'force': False})
    remote_package = api('contents/package.json?ref=main')
    assert json.loads(base64.b64decode(remote_package['content']))['version'] == version
    print(f'SOURCE_PUSHED_VIA_API files={len(elements)} version={version}')

def publish():
    notes = f'''PhD 科研工作台 v{version}

本版本修复 Windows 正式包的启动失败问题。

## 改进

- 调整主进程构建方式，使正式包独立包含所需的 JavaScript 运行时依赖。
- 改进发布流程，避免构建检查误用源码目录中的开发依赖。

## 修复

- 修复安装后启动时因缺少 `zod`、`date-fns` 或 `fast-xml-parser` 而出现 `ERR_MODULE_NOT_FOUND` 的问题。'''
    release = next((item for item in api('releases?per_page=30') if item['tag_name'] == f'v{version}'), None)
    if release is None:
        release = api('releases', 'POST', {'tag_name': f'v{version}', 'target_commitish': 'main', 'name': f'PhD 科研工作台 v{version}', 'body': notes, 'draft': True, 'prerelease': False})
    paths = [workspace / 'test-results' / f'fixes-{version}' / 'update-assets' / 'latest-update.json',
             workspace / 'release' / f'PhD-Research-Workbench-{version}-Setup.exe',
             workspace / 'test-results' / f'fixes-{version}' / 'update-assets' / f'PhD-Research-Workbench-{version}-Update.zip']
    for path in paths:
        existing = next((item for item in release['assets'] if item['name'] == path.name), None)
        if existing:
            if existing['state'] == 'uploaded' and existing['size'] == path.stat().st_size:
                print(f'ASSET_ALREADY_UPLOADED {path.name}', flush=True)
                continue
            raise RuntimeError(f'Incomplete existing asset: {path.name}')
        upload_path = f'/repos/{repository}/releases/{release["id"]}/assets?name={urllib.parse.quote(path.name)}'
        args = [os.environ.get('WORKBENCH_UPLOAD_CURL', 'curl.exe'), '--config', '-', '--silent', '--show-error', '--fail', '--http1.1', '--tlsv1.2', '--tls-max', '1.2', '--max-time', '600',
                '--request', 'POST', '--data-binary', f'@{path}', '--header', 'Expect:', '--header', 'Content-Type: application/octet-stream', f'https://uploads.github.com{upload_path}']
        args += ['--proxy', proxy_url] if proxy_url and os.environ.get('WORKBENCH_UPLOAD_DIRECT') != '1' else ['--noproxy', '*']
        response = run_curl(args)
        if response.returncode:
            raise RuntimeError(f'GitHub upload failed: {response.stderr.strip()}')
        asset = json.loads(response.stdout)
        if asset['state'] != 'uploaded' or asset['size'] != path.stat().st_size:
            raise RuntimeError('GitHub asset upload incomplete')
        print(f'ASSET_UPLOADED {path.name}', flush=True)
    published = api(f'releases/{release["id"]}', 'PATCH', {'draft': False, 'make_latest': 'true'})
    latest = api('releases/latest')
    assert latest['tag_name'] == f'v{version}'
    remote_package = api('contents/package.json?ref=main')
    import base64
    assert json.loads(base64.b64decode(remote_package['content']))['version'] == version
    result = {'version': version, 'url': published['html_url'], 'sourceFilesCompared': True,
              'assets': [{'name': item['name'], 'size': item['size'], 'state': item['state']} for item in latest['assets']]}
    (evidence / 'publication.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))

parser = argparse.ArgumentParser()
parser.add_argument('operation', choices=['inspect', 'sync', 'sync_api', 'publish'])
globals()[parser.parse_args().operation]()
