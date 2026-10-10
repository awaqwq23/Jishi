import test from 'node:test';
import assert from 'node:assert/strict';
import {hasAgentReminderGrant} from './harmony-profile-policy.mjs';

test('approved AGC open-service Profile passes with an empty ACL list',()=>{
  assert.equal(hasAgentReminderGrant({acls:{'allowed-acls':[]},
    'app-services-capabilities':{'com.huawei.service.notification.agentreminder':{}}}),true);
});
test('legacy explicit ACL grant remains supported',()=>{
  assert.equal(hasAgentReminderGrant({acls:{'allowed-acls':['ohos.permission.PUBLISH_AGENT_REMINDER']}}),true);
});
test('missing, unrelated and malformed grants cannot pass the release gate',()=>{
  const name='com.huawei.service.notification.agentreminder';
  for(const services of [undefined,null,[],{}, {other:{}}, {[name]:null}, {[name]:false},
    {[name]:[]},Object.create({[name]:{}})]) {
    assert.equal(hasAgentReminderGrant({'app-services-capabilities':services}),false);
  }
  assert.equal(hasAgentReminderGrant({acls:{'allowed-acls':'ohos.permission.PUBLISH_AGENT_REMINDER'}}),false);
});
