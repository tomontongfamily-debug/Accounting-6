export function notificationAudience(session) {
  if(session?.role==='Admin')return {role:'Admin',branch:''};
  if(session?.role==='Manager'&&session.branch==='Liloan')return {role:'Manager',branch:'Liloan'};
  return null;
}

// Registrations predating station alerts belong to Admin.
export function subscriptionMatchesAudience(subscription,audience) {
  return (subscription.role||'Admin')===audience?.role
    && (audience.role==='Admin'||subscription.branch===audience.branch);
}

export function receivesReportAlert(subscription,alert) {
  return subscriptionMatchesAudience(subscription,{role:'Admin',branch:''})
    || subscriptionMatchesAudience(subscription,{role:'Manager',branch:'Liloan'})&&alert.branch==='Liloan';
}
