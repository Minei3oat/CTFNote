import {
  ActionRowBuilder,
  ApplicationCommandType,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
  CommandInteraction,
  PermissionFlagsBits,
} from "discord.js";
import { Command } from "../../interfaces/command";
import {
  createTask,
  getAllCtfsFromDatabase,
  getCtfFromDatabase,
} from "../../database/ctfs";
import { getChannelCategoriesForCtf } from "../channels";
import {
  convertMessagesToPadFormat,
  createPadWithoutLimit,
  getMessagesOfCategories,
} from "../../utils/messages";
import { DiscordButtonInteraction } from "../../interfaces/interaction";

async function handleArchiveInteraction(
  interaction: ButtonInteraction,
  ctfName: string
) {
  const guild = interaction.guild;
  if (guild == null) return false;

  const ctf = await getCtfFromDatabase(ctfName);
  if (ctf == null) return false;

  const categories = getChannelCategoriesForCtf(guild, ctf.title);
  if (categories.size === 0) return false;

  const messages = await getMessagesOfCategories(
    Array.from(categories.values())
  );

  const padMessages = await convertMessagesToPadFormat(messages);

  const padUrl = await createPadWithoutLimit(padMessages, ctf.title);

  await createTask(
    `${ctf.title} Discord archive`,
    `Discord archive of ${ctf.title}`,
    "",
    padUrl,
    ctf.id
  );

  return true;
}

export const HandleArchiveCtfInteraction: DiscordButtonInteraction = {
  customId: "archive-ctf-button",
  handle: async (client: Client, interaction: ButtonInteraction) => {
    const ctfName = interaction.customId.replace("archive-ctf-button-", "");
    await interaction.deferUpdate();
    await interaction.editReply({
      content: `Archiving the CTF channels and roles for ${ctfName}`,
      components: [],
    });

    if (await handleArchiveInteraction(interaction, ctfName)) {
      await interaction.editReply({
        content: `Archived the CTF channels and roles for ${ctfName}`,
        components: [],
      });
    } else {
      await interaction.editReply({
        content: `Failed to archive the CTF channels and roles for ${ctfName}`,
        components: [],
      });
    }
  },
};

async function archiveCtfLogic(
  client: Client,
  interaction: CommandInteraction
) {
  // Get current CTFs from the discord categories
  let ctfNames = await getAllCtfsFromDatabase();
  const guild = interaction.guild;
  if (guild == null) return;
  ctfNames = ctfNames.filter(
    (ctfName) => getChannelCategoriesForCtf(guild, ctfName).size !== 0
  );

  if (ctfNames.length === 0) {
    await interaction.editReply({
      content: "No CTFs found!",
    });
    return;
  }

  const buttons: ButtonBuilder[] = [];
  for (let i = 0; i < ctfNames.length; i++) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`archive-ctf-button-${ctfNames[i]}`)
        .setLabel(ctfNames[i])
        .setStyle(ButtonStyle.Success)
    );
  }

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    buttons
  );

  await interaction.editReply({
    content: "Which CTF do you want to archive?",
    components: [actionRow],
  });
}

export const ArchiveCtf: Command = {
  name: "archive",
  description: "Archive the CTF messages!",
  type: ApplicationCommandType.ChatInput,
  defaultMemberPermissions: [PermissionFlagsBits.Administrator],
  run: async (client, interaction) => {
    return archiveCtfLogic(client, interaction).catch((e) => {
      console.error("Error during archive ctf logic: ", e);
    });
  },
};
