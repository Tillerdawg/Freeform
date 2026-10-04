import json, pathlib, re, subprocess, hashlib
root=pathlib.Path.cwd(); out=root/'evidence/m8-pdf-foundation/recovery-r2/huffer-review'
old=subprocess.check_output(['git','show','HEAD:src/persistence/freeform-file.ts'],text=True)
new=(root/'src/document/uri.ts').read_text()
pattern=r'const AJV_URI = (.*);'
old_match=re.search(pattern,old); new_match=re.search(pattern,new)
assert old_match is not None and new_match is not None
assert old_match.group(1)==new_match.group(1)
results=json.loads((out/'extended-results.json').read_text()); assert len(results)==17
for r in results:
 assert 'rejected' not in r
 name=r['name']; val=r['result']
 if name.startswith('invalid $schema') or name=='structural missing ftl':
  assert r['canonical']['code']=='SCHEMA'
  assert val=={'ok':False,'code':'document-invalid','messageKey':'pdfExport.error.documentInvalid.schema','detail':[]}
 elif name in ['ftl-end-mismatch','ftl-offset-order','insufficient-ftl-path','stale missing member']:
  assert r['canonical']['name']=='FtlValidationError'
  assert val=={'ok':False,'code':'document-invalid','messageKey':'pdfExport.error.documentInvalid.ftl','detail':[]}
 elif name.startswith('valid'):
  assert r['canonical']=='accepted' and val=={'ok':True,'pages':2}
 elif name.startswith('download'):
  assert val==({'ok':False,'code':'download-dispatch-failed'} if name in ['download append','download click'] else {'ok':True})
  assert r['calls'][-2:]==['remove','revoke']
for file in ['fresh-a-probe.json','fresh-b-probe.json']:
 rs=json.loads((out/file).read_text());assert len(rs)==11
 for r in rs:
  assert 'rejected' not in r and 'threw' not in r
  if r['name'].startswith('valid'):assert r['ok'] and r['pages']==5
  elif r['name']=='revoke throws':assert r['result']=={'ok':True}
  else:assert not r['ok'] and r['code']=='document-invalid' and r['messageKey']=='pdfExport.error.documentInvalid.schema'
q=json.loads((out/'qualification.json').read_text());assert q['pageCount']==5 and q['pageSizePoints']==[{'width':792,'height':612}]*5
assert all(v for _,v in q['extractedContains']) and q['language']=='en-US'
assert q['byteDeterminism']['allFourIdentical']
identity=json.loads((out/'identity.json').read_text())
assert all(hashlib.sha256((root/k).read_bytes()).hexdigest()==v for k,v in identity['sourceHashes'].items())
prior=json.loads((root/'evidence/m8-pdf-foundation/huffer-review/round2/identity.json').read_text())
print('Historical identity keys',list(prior))
# Report imports: production foundation and validator stay pure; tests may use store spies.
for file in sorted((root/'src/pdf').glob('*.ts'))+[root/'src/document/export-snapshot-validation.ts',root/'src/document/uri.ts']:
 if file.name.endswith('.test.ts'):continue
 imports=re.findall(r"(?:from|import)\s*['\"]([^'\"]+)['\"]",file.read_text())
 assert not any('persistence' in i or 'command-store' in i for i in imports)
 print(str(file.relative_to(root)),imports)
report={'uriRegexIdenticalToOriginalPersistence':True,'extendedCases':len(results),'historicalBoundaryCasesPerProcess':11,'sourceIdentityRechecked':True,'qualifiedFiveLetterPages':True,'allUnicodeTokensExtracted':True,'allFourFreshGeneratedPdfHashesEqual':True,'noProductionFoundationStorePersistenceImports':True}
(out/'assertions.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
