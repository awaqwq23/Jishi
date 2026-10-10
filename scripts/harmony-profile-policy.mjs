// AGC writes approved open services separately from restricted ACL permissions.
export function hasAgentReminderGrant(profile) {
  const acls=profile.acls?.['allowed-acls'];
  if(Array.isArray(acls) && acls.includes('ohos.permission.PUBLISH_AGENT_REMINDER')) return true;
  const services=profile['app-services-capabilities'];
  const name='com.huawei.service.notification.agentreminder';
  return services !== null && typeof services === 'object' && !Array.isArray(services) &&
    Object.hasOwn(services,name) && services[name] !== null &&
    typeof services[name] === 'object' && !Array.isArray(services[name]);
}
