import { Events, type Client, type Guild, type GuildMember, type Message, type User, type VoiceState } from "discord.js";
import {
  RELIABLE_DELIVERY_SCHEMA_VERSION, RELIABLE_EVENT_PRIORITY, reliablePartitionKey,
  type AutomationEventContext, type AutomationTriggerId, type ReliableEnvelope,
} from "@bot/shared";
import type { ConfigCache } from "./config-cache.js";
import type { Outbox } from "./outbox/index.js";

function userContext(user:User,member?:GuildMember|null){return{id:user.id,name:user.username,bot:user.bot,roleIds:member?[...member.roles.cache.keys()].filter(id=>id!==member.guild.id):undefined,accountCreatedAt:user.createdAt.toISOString(),joinedAt:member?.joinedAt?.toISOString()};}
function guildContext(guild:Guild){return{id:guild.id,name:guild.name};}
function messageContext(message:Message){return{id:message.id,content:message.content.slice(0,4000),webhook:message.webhookId!==null};}

export function buildAutomationEnvelope(guildId:string,context:AutomationEventContext,now=Date.now()):ReliableEnvelope{
  const eventId=crypto.randomUUID();
  return{schemaVersion:RELIABLE_DELIVERY_SCHEMA_VERSION,eventId,type:"automation_event",guildId,partitionKey:reliablePartitionKey(guildId),priority:RELIABLE_EVENT_PRIORITY.automation_event,occurredAt:now,payload:{context,correlationId:crypto.randomUUID(),rootEventId:eventId,depth:context.event.depth}};
}

export function registerAutomations(client:Client,cache:ConfigCache,outbox:Outbox):void{
  async function emit(guildId:string,trigger:AutomationTriggerId,context:AutomationEventContext):Promise<void>{
    const config=await cache.get(guildId);if(!config?.automationTriggers.includes(trigger))return;
    const envelope=buildAutomationEnvelope(guildId,context);
    if(!outbox.enqueue(envelope))console.warn(`automation event dropped: ${trigger} ${guildId}`);
  }
  const base=(type:AutomationTriggerId,guild:Guild,id?:string)=>({event:{type,id,depth:0 as const},guild:guildContext(guild)});

  client.on(Events.MessageCreate,message=>{if(!message.guild||message.author.id===client.user?.id)return;void emit(message.guild.id,"message_create",{...base("message_create",message.guild,message.id),user:userContext(message.author,message.member),channel:{id:message.channel.id,name:"name"in message.channel?message.channel.name:undefined,categoryId:"parentId"in message.channel?message.channel.parentId:undefined},message:messageContext(message)}).catch(console.error);});
  client.on(Events.GuildMemberAdd,member=>void emit(member.guild.id,"member_join",{...base("member_join",member.guild,member.id),user:userContext(member.user,member)}).catch(console.error));
  client.on(Events.GuildMemberRemove,member=>void emit(member.guild.id,"member_leave",{...base("member_leave",member.guild,member.id),user:userContext(member.user,member.partial?null:member)}).catch(console.error));
  client.on(Events.MessageReactionAdd,async(reaction,user)=>{if(reaction.partial)await reaction.fetch().catch(()=>null);if(user.partial)user=await user.fetch().catch(()=>user as User);const message=reaction.message;if(!message.guild||user.id===client.user?.id)return;const member=message.guild.members.cache.get(user.id);void emit(message.guild.id,"reaction_add",{...base("reaction_add",message.guild,message.id),user:userContext(user as User,member),channel:{id:message.channel.id,name:"name"in message.channel?(message.channel.name??undefined):undefined,categoryId:"parentId"in message.channel?(message.channel.parentId??undefined):undefined},message:{id:message.id},reaction:{emoji:reaction.emoji.id??reaction.emoji.name??""}}).catch(console.error);});
  client.on(Events.VoiceStateUpdate,(oldState,newState)=>{const oldId=oldState.channelId,newId=newState.channelId;if(oldId===newId)return;const trigger:AutomationTriggerId=!oldId&&newId?"voice_join":oldId&&!newId?"voice_leave":"voice_move";const state:VoiceState=newId?newState:oldState,member=state.member;if(!member)return;void emit(state.guild.id,trigger,{...base(trigger,state.guild,member.id),user:userContext(member.user,member),channel:newState.channel?{id:newState.channel.id,name:newState.channel.name,categoryId:newState.channel.parentId}:oldState.channel?{id:oldState.channel.id,name:oldState.channel.name,categoryId:oldState.channel.parentId}:undefined,voice:{channel:newState.channel?.name??oldState.channel?.name,channelId:newId??undefined,previousChannelId:oldId??undefined}}).catch(console.error);});
  client.on(Events.GuildMemberUpdate,(before,after)=>{const beforeRoles=new Set(before.roles.cache.keys()),afterRoles=new Set(after.roles.cache.keys());for(const roleId of afterRoles)if(!beforeRoles.has(roleId))void emit(after.guild.id,"role_added",{...base("role_added",after.guild,after.id),user:userContext(after.user,after),role:{id:roleId}}).catch(console.error);for(const roleId of beforeRoles)if(!afterRoles.has(roleId))void emit(after.guild.id,"role_removed",{...base("role_removed",after.guild,after.id),user:userContext(after.user,after),role:{id:roleId}}).catch(console.error);});
}
