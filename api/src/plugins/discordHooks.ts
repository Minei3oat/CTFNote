import { Build, Context } from "postgraphile";
import { SchemaBuilder } from "graphile-build";
import {
  CategoryChannel,
  ChannelType,
  Guild,
  GuildBasedChannel,
  TextChannel,
} from "discord.js";
import {
  getCTFNameFromId,
  getCtfById,
  getNameFromUserId,
  getTaskFromId,
} from "../discord/database/ctfs";
import { getDiscordGuild, usingDiscordBot } from "../discord";
import { changeDiscordUserRoleForCTF } from "../discord/commands/linkUser";

export async function handleTaskSolved(id: bigint) {
  const task = await getTaskFromId(id);

  return sendMessageFromTaskId(id, `${task.title} is solved!`)
    .then(async (channel) => {
      if (channel !== null) {
        return channel.setName(`solved-${task.title}`);
      }
    })
    .catch((err) => {
      console.error("Failed sending solved notification.", err);
    });
}

const discordMutationHook = (_build: Build) => (fieldContext: Context<any>) => {
  const {
    scope: { isRootMutation },
  } = fieldContext;

  if (!isRootMutation) return null;

  if (!usingDiscordBot) return null;

  if (
    fieldContext.scope.fieldName !== "updateTask" &&
    fieldContext.scope.fieldName !== "createTask" &&
    fieldContext.scope.fieldName !== "deleteTask" &&
    fieldContext.scope.fieldName !== "startWorkingOn" &&
    fieldContext.scope.fieldName !== "stopWorkingOn" &&
    fieldContext.scope.fieldName !== "addTagsForTask" &&
    fieldContext.scope.fieldName !== "updateCtf" &&
    fieldContext.scope.fieldName !== "createInvitation" &&
    fieldContext.scope.fieldName !== "deleteInvitation"
  ) {
    return null;
  }

  const handleDiscordMutationAfter = async (
    input: any,
    args: any,
    context: any
  ) => {
    const guild = getDiscordGuild();
    if (guild === null) return null;

    //add challenges to the ctf channel discord
    if (fieldContext.scope.fieldName === "createTask") {
      const ctfName = await getCTFNameFromId(args.input.ctfId);

      const categoryChannel = guild?.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildCategory && channel.name === ctfName
      ) as CategoryChannel | undefined;

      if (categoryChannel === undefined) {
        return null;
      }

      categoryChannel.guild.channels
        .create({
          name: `${args.input.title}`,
          type: ChannelType.GuildText,
          parent: categoryChannel.id,
          topic: args.input.title,
        })
        .catch((err) => {
          console.error("Failed creating category.", err);
        });

      //send message to the main channel that a new task has been created
      const mainChannel = guild?.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildText &&
          channel.name === "challenges-talk" &&
          channel.parentId === categoryChannel.id
      ) as TextChannel | undefined;

      if (mainChannel !== undefined) {
        mainChannel
          .send(`New task created: ${args.input.title}`)
          .catch((err) => {
            console.error("Failed to send notification about a new task.", err);
          });
      }
    }
    if (fieldContext.scope.fieldName === "deleteTask") {
      const task = await getTaskFromId(args.input.id);

      const channel = guild?.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildText && channel.topic === task.title
      ) as CategoryChannel | undefined;

      if (channel === undefined) return null;

      channel
        .setName(`${task.title}-deleted`)
        .catch((err) =>
          console.error("Failed to mark channel as deleted.", err)
        );
    }

    // handle task (un)solved
    if (
      fieldContext.scope.fieldName === "updateTask" &&
      args.input.id !== null
    ) {
      const task = await getTaskFromId(args.input.id);
      let title = task.title;
      if (args.input.patch.title !== null) {
        title = args.input.patch.title;
      }

      if (args.input.patch.flag !== null) {
        if (args.input.patch.flag !== "") {
          handleTaskSolved(args.input.id);
        } else {
          const task = await getTaskFromId(args.input.id);

          const channel = guild?.channels.cache.find(
            (channel) =>
              channel.type === ChannelType.GuildText &&
              channel.topic === task.title
          ) as TextChannel | undefined;

          if (channel === undefined) return null;

          channel
            .setName(`${task.title}`)
            .catch((err) =>
              console.error("Failed to mark channel as unsolved.", err)
            );
        }
      }

      // handle task title change
      if (
        args.input.patch.title !== null &&
        args.input.patch.title !== task.title
      ) {
        const channel = guild?.channels.cache.find(
          (channel) =>
            channel.type === ChannelType.GuildText &&
            channel.topic === task.title
        ) as TextChannel | undefined;

        if (channel === undefined) return null;
        channel
          .edit({
            name: title,
            topic: title,
          })
          .catch((err) => console.error("Failed to rename channel.", err));
      }

      // handle task description change
      if (
        args.input.patch.description != null &&
        args.input.patch.description !== task.description
      ) {
        sendMessageFromTaskId(
          task.id,
          `Description changed:\n${args.input.patch.description}`
        );
      }
    }

    if (fieldContext.scope.fieldName === "startWorkingOn") {
      //send a message to the channel that the user started working on the task
      const userId = context.jwtClaims.user_id;
      const taskId = args.input.taskId;

      getNameFromUserId(userId)
        .then((username) => {
          return sendMessageFromTaskId(
            taskId,
            `${username} is working on this task!`
          );
        })
        .catch((err) => {
          console.error("Failed sending 'working on' notification.", err);
        });
    }
    if (fieldContext.scope.fieldName === "stopWorkingOn") {
      //send a message to the channel that the user stopped working on the task
      const userId = context.jwtClaims.user_id;
      const taskId = args.input.taskId;

      getNameFromUserId(userId)
        .then((username) => {
          return sendMessageFromTaskId(
            taskId,
            `${username} stopped working on this task!`
          );
        })
        .catch((err) => {
          console.error(
            "Failed sending 'stopped working on' notification.",
            err
          );
        });
    }
    if (fieldContext.scope.fieldName === "createInvitation") {
      handeInvitation(
        args.input.invitation.ctfId,
        args.input.invitation.profileId,
        "add"
      );
    }

    if (fieldContext.scope.fieldName === "deleteInvitation") {
      handeInvitation(args.input.ctfId, args.input.profileId, "remove");
    }

    return input;
  };

  const handleDiscordMutationBefore = async (
    input: any,
    args: any,
    context: any
  ) => {
    const guild = getDiscordGuild();
    if (guild === null) return null;
    if (fieldContext.scope.fieldName === "updateCtf") {
      handleUpdateCtf(args, guild);
    }

    return input;
  };

  return {
    before: [
      {
        priority: 500,
        callback: handleDiscordMutationBefore,
      },
    ],
    after: [
      {
        priority: 500,
        callback: handleDiscordMutationAfter,
      },
    ],
    error: [],
  };
};

async function handeInvitation(
  ctfId: bigint,
  profileId: bigint,
  operation: "add" | "remove"
) {
  const ctf = await getCtfById(ctfId);
  await changeDiscordUserRoleForCTF(profileId, ctf, operation);
}

async function handleUpdateCtf(args: any, guild: Guild) {
  const ctf = await getCTFNameFromId(args.input.id);

  const categoryChannel = guild?.channels.cache.find(
    (channel) =>
      channel.type === ChannelType.GuildCategory && channel.name === ctf
  ) as CategoryChannel | undefined;

  if (categoryChannel != null) {
    categoryChannel.setName(args.input.patch.title).catch((err) => {
      console.error("Failed updating category.", err);
    });
  }

  const role = guild?.roles.cache.find((role) => role.name === ctf);
  role?.setName(args.input.patch.title).catch((err) => {
    console.error("Failed updating role.", err);
  });
}

async function sendMessageFromTaskId(
  id: bigint,
  message: string
): Promise<GuildBasedChannel | null> {
  const task = await getTaskFromId(id);
  const ctfName = await getCTFNameFromId(BigInt(task.ctf_id));

  const guild = getDiscordGuild();

  if (guild === null) {
    console.error("Guild not found");
    return null;
  }

  const channelsArray = Array.from(guild.channels.cache.values());
  for (const channel of channelsArray) {
    if (
      channel.type === ChannelType.GuildText &&
      channel.topic === task.title &&
      channel.parent?.name === ctfName
    ) {
      channel.send(message);
      return channel;
    }
  }

  return null;
}

export default function (builder: SchemaBuilder): void {
  builder.hook("init", (_, build) => {
    build.addOperationHook(discordMutationHook(build));
    return _;
  });
}
