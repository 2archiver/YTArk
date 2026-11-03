import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { extractAssignedFunctions } from '../utils/ASTParser.js';
import { patchPlaybackMenu } from '../ui/playbackMenu.js';
const buttonItem = (title, icon, commands) => ({ compactLinkRenderer:{ title, icon,
  serviceEndpoint:{ commandExecutorCommand:{commands} } } });
test('reopening a cached playback menu does not grow rows or duplicate actions', () => {
  const items = [{compactLinkRenderer:{icon:{iconType:'VIDEO_QUALITY'}}},
    {compactLinkRenderer:{icon:{iconType:'SLOW_MOTION_VIDEO'},subtitle:{simpleText:'Speed'}}}];
  for(let i=0;i<100;i++) {
    assert.equal(patchPlaybackMenu(items,{buttonItem,t:x=>x,pip:true}),true);
    assert.equal(items.length,6);
    const ids=items.map(x=>x.compactLinkRenderer?.itemId).filter(Boolean);
    assert.equal(new Set(ids).size,4);
  }
  patchPlaybackMenu(items,{buttonItem,t:x=>x,pip:false});
  assert.equal(items.length,5);
  assert.equal(items.some(x=>x.compactLinkRenderer?.itemId==='ytark-playback-enter_pip'),false);
  assert.equal(patchPlaybackMenu(undefined,{buttonItem,t:x=>x}),false);
});
test('player constructor AST is parsed once across repeated control construction', () => {
  function Original() {
    this.settings=function(){return [{type:'TRANSPORT_CONTROLS_BUTTON_TYPE_PLAYBACK_SETTINGS'},
      {type:'TRANSPORT_CONTROLS_BUTTON_TYPE_FEATURED_ACTION'}];};
    this.previous=function(){return 'skipNextButton skipPreviousButton';};
    this.next=function(){return 'skipPreviousButton skipNextButton';};
    this.engagement=function(){return ['props.data.engagementActions'];};
  }
  let parses=0;
  const source=readFileSync(new URL('../ui/customUI.js',import.meta.url),'utf8').replace(/^import .*;\s*$/gm,'');
  const window={_yttv:{Original}};
  vm.runInNewContext(source,{window,document:{readyState:'complete',querySelector:()=>({})},console,
    setTimeout:()=>{throw new Error('unexpected poll');},
    extractAssignedFunctions:code=>{parses++;return extractAssignedFunctions(code);},
    configRead:key=>['enablePatchingVideoPlayer','enableMPButton','enableSpeedControlsButton','enablePreviousNextButtons'].includes(key),
    ButtonRenderer:()=>({}),t:x=>x});
  assert.notEqual(window._yttv.Original,Original);
  for(let i=0;i<100;i++)new window._yttv.Original();
  assert.equal(parses,1);
});
