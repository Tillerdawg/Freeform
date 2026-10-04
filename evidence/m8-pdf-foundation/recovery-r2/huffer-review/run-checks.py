import subprocess, pathlib, json, hashlib, shutil, os
root=pathlib.Path.cwd()
out=root/'evidence/m8-pdf-foundation/recovery-r2/huffer-review'
results=[]
def run(name,command):
    p=subprocess.run(command,shell=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    (out/(name+'.log')).write_text(p.stdout)
    results.append({'name':name,'command':command,'exit':p.returncode})
    (out/'gates.json').write_text(json.dumps(results,indent=2))
    print(name, 'exit',p.returncode, p.stdout[-1200:],flush=True)
    return p.returncode
for name, command in [('test','npm test'),('docs','npm run test:docs'),('build','npm run build'),('diff','git diff --check'),('extended','node '+str(out/'extended-probe.mjs')),('fresh-a','node '+str(out/'boundary-probe.mjs')+' fresh-a'),('fresh-b','node '+str(out/'boundary-probe.mjs')+' fresh-b')]:
    run(name,command)
for source,target in [('fresh-a-0.pdf','same-runtime-a.pdf'),('fresh-a-1.pdf','same-runtime-b.pdf'),('fresh-b-0.pdf','fresh-runtime-a.pdf'),('fresh-b-1.pdf','fresh-runtime-b.pdf')]:
    shutil.copyfile(out/source,out/target)
run('qualification','node scripts/qualify-m8-pdf.mjs '+str(out/'same-runtime-a.pdf')+' '+str(out))
def git(*args): return subprocess.check_output(['git',*args],text=True).strip()
paths=git('diff','--name-only').splitlines()+git('ls-files','--others','--exclude-standard').splitlines()
paths=sorted(set(p for p in paths if p.startswith(('src/','decisions/','scripts/')) or p in ['package.json','package-lock.json']))
hashes={p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in paths}
pdfhashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in out.glob('*.pdf')}
old=json.loads((root/'evidence/m8-pdf-foundation/recovery-r2/identity.json').read_text())
identity={'head':git('rev-parse','HEAD'),'branch':git('branch','--show-current'),'status':git('status','--short','--untracked-files=all'),'sourceHashes':hashes,'pdfHashes':pdfhashes,'trackedDiffSha256':hashlib.sha256(subprocess.check_output(['git','diff','--binary'])).hexdigest(),'node':subprocess.check_output(['node','--version'],text=True).strip(),'npm':subprocess.check_output(['npm','--version'],text=True).strip()}
(out/'identity.json').write_text(json.dumps(identity,indent=2))
print(json.dumps({'pdfHashes':pdfhashes,'sourceHashes':hashes},indent=2))
assert len(set(pdfhashes.values()))==1
assert all(r['exit']==0 for r in results)
