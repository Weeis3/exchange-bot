const { Client, IntentsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const mongoose = require('mongoose');
require('dotenv').config();

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent
    ]
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/discordBot')
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// MongoDB Schemas
const ticketSchema = new mongoose.Schema({
    userId: String,
    channelId: String,
    guildId: String,
    closed: { type: Boolean, default: false }
});

const vouchSchema = new mongoose.Schema({
    sellerId: String,
    voucherId: String,
    guildId: String,
    stars: Number,
    product: String,
    message: String,
    timestamp: { type: Date, default: Date.now }
});

const Ticket = mongoose.model('Ticket', ticketSchema);
const Vouch = mongoose.model('Vouch', vouchSchema);

// Configuration
const config = {
    ticketCategory: 'Tickets',
    vouchRole: 'Trusted Seller',
    logChannel: 'bot-logs',
    requiredVouchText: '+rep'
};

// Slash Commands
const commands = [
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Setup the ticket system')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
        .setName('vouch')
        .setDescription('Vouch for a seller')
        .addUserOption(option =>
            option.setName('seller')
                .setDescription('The seller you want to vouch for')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('close')
        .setDescription('Close your ticket')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    new SlashCommandBuilder()
        .setName('vouchinfo')
        .setDescription('Get info about a seller\'s vouches')
        .addUserOption(option =>
            option.setName('seller')
                .setDescription('The seller to check')
                .setRequired(false))
];

client.on('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    // Register commands
    try {
        await client.application.commands.set(commands);
        console.log('Slash commands registered successfully');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
});

// Ticket System
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    // Ticket creation
    if (interaction.customId === 'create_ticket') {
        await handleCreateTicket(interaction);
    }

    // Vouch initiation
    if (interaction.customId === 'start_vouch') {
        await handleStartVouch(interaction);
    }

    // Close ticket
    if (interaction.customId === 'close_ticket') {
        await handleCloseTicket(interaction);
    }
});

// Vouch modal submission
client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;
    if (interaction.customId !== 'vouch_modal') return;

    await handleVouchModal(interaction);
});

// Slash Command Handling
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName, options } = interaction;

    switch (commandName) {
        case 'setup':
            await handleSetupCommand(interaction);
            break;
        case 'vouch':
            await handleVouchCommand(interaction, options.getUser('seller'));
            break;
        case 'close':
            await handleCloseCommand(interaction);
            break;
        case 'vouchinfo':
            await handleVouchInfoCommand(interaction, options.getUser('seller'));
            break;
    }
});

// Command Handlers
async function handleSetupCommand(interaction) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
            content: 'You need the "Manage Server" permission to use this command.',
            ephemeral: true
        });
    }

    const embed = new EmbedBuilder()
        .setTitle('Support Tickets')
        .setDescription('Click the button below to create a support ticket')
        .setColor(0x3498db);

    const button = new ButtonBuilder()
        .setCustomId('create_ticket')
        .setLabel('Create Ticket')
        .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(button);

    await interaction.reply({
        embeds: [embed],
        components: [row],
        ephemeral: false // Public setup message
    });
}

async function handleVouchCommand(interaction, seller) {
    if (interaction.user.id === seller.id) {
        return interaction.reply({
            content: "You can't vouch for yourself!",
            ephemeral: true
        });
    }

    const embed = new EmbedBuilder()
        .setTitle('Vouch for Seller')
        .setDescription(`Click the button below to vouch for ${seller}`)
        .setColor(0xF1C40F);

    const button = new ButtonBuilder()
        .setCustomId('start_vouch')
        .setLabel('Add Vouch')
        .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    await interaction.reply({
        content: `${interaction.user} wants to vouch for ${seller}`,
        embeds: [embed],
        components: [row],
        ephemeral: true
    });
}

async function handleCloseCommand(interaction) {
    if (!interaction.channel.name.startsWith('ticket-')) {
        return interaction.reply({
            content: "This command can only be used in ticket channels.",
            ephemeral: true
        });
    }

    const ticket = await Ticket.findOne({
        channelId: interaction.channel.id,
        closed: false
    });

    if (!ticket) {
        return interaction.reply({
            content: "This is not an active ticket channel.",
            ephemeral: true
        });
    }

    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages) && interaction.user.id !== ticket.userId) {
        return interaction.reply({
            content: "Only staff or the ticket creator can close tickets.",
            ephemeral: true
        });
    }

    ticket.closed = true;
    await ticket.save();

    await interaction.reply({
        content: "Closing this ticket in 5 seconds...",
        ephemeral: false // Public in ticket channel
    });
    setTimeout(async () => {
        await interaction.channel.delete();
    }, 5000);
}

async function handleVouchInfoCommand(interaction, seller) {
    const targetSeller = seller || interaction.user;
    const vouches = await Vouch.find({ sellerId: targetSeller.id });
    let vouchRole = interaction.guild.roles.cache.find(r => r.name === config.vouchRole);

    if (!vouchRole) {
        vouchRole = await interaction.guild.roles.create({
            name: config.vouchRole,
            color: 'GOLD',
            reason: 'Role for vouched sellers'
        });
    }
    if (!targetSeller.roles.cache.has(vouchRole.id)) {
        await interaction.reply({
            content: "Not a valid seller!",
            ephemeral: true
        })
    }
    if (vouches.length === 0) {
        return interaction.reply({
            content: `${targetSeller} has no vouches yet.`,
            ephemeral: true
        });
    }

    const totalStars = vouches.reduce((sum, vouch) => sum + vouch.stars, 0);
    const averageRating = (totalStars / vouches.length).toFixed(1);

    const embed = new EmbedBuilder()
        .setTitle(`${targetSeller.username}'s Vouches`)
        .setDescription(`Total vouches: ${vouches.length}\nAverage rating: ${averageRating}⭐`)
        .setColor(0xF1C40F);

    // Add recent vouches (up to 3)
    const recentVouches = vouches.slice(-3).reverse();
    for (const vouch of recentVouches) {
        const voucher = await client.users.fetch(vouch.voucherId);
        embed.addFields({
            name: `${vouch.stars}⭐ from ${voucher.username}`,
            value: `${vouch.product}\n${vouch.message}`,
            inline: false
        });
    }

    await interaction.reply({
        embeds: [embed],
        ephemeral: true // Private vouch info
    });
}

// Button Handlers
async function handleCreateTicket(interaction) {
    const existingTicket = await Ticket.findOne({
        userId: interaction.user.id,
        guildId: interaction.guild.id,
        closed: false
    });

    if (existingTicket) {
        const channel = interaction.guild.channels.cache.get(existingTicket.channelId);
        if (channel) {
            return interaction.reply({
                content: `You already have an open ticket: ${channel}`,
                ephemeral: true
            });
        }
    }

    let category = interaction.guild.channels.cache.find(
        c => c.name === config.ticketCategory && c.type === 4
    );

    if (!category) {
        category = await interaction.guild.channels.create({
            name: config.ticketCategory,
            type: 4 // Category
        });
    }

    const channel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        type: 0, // Text channel
        parent: category.id,
        permissionOverwrites: [
            {
                id: interaction.guild.id,
                deny: ['ViewChannel']
            },
            {
                id: interaction.user.id,
                allow: ['ViewChannel', 'SendMessages']
            }
        ]
    });

    const newTicket = new Ticket({
        userId: interaction.user.id,
        channelId: channel.id,
        guildId: interaction.guild.id
    });
    await newTicket.save();

    const embed = new EmbedBuilder()
        .setTitle(`Ticket for ${interaction.user.username}`)
        .setDescription('Support will be with you shortly.')
        .setColor(0x00FF00);

    await channel.send({
        content: `${interaction.user}, support will be with you shortly.`,
        embeds: [embed]
    });

    // Add close button to ticket
    const closeButton = new ButtonBuilder()
        .setCustomId('close_ticket')
        .setLabel('Close Ticket')
        .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(closeButton);
    await channel.send({
        content: 'Click the button below to close this ticket:',
        components: [row]
    });

    await interaction.reply({
        content: `Your ticket has been created: ${channel}`,
        ephemeral: true // Private confirmation
    });

    logAction(interaction.guild, `Ticket created by ${interaction.user.tag} (${channel})`);
}

async function handleStartVouch(interaction) {
    const sellerId = interaction.message.mentions.users.first().id;
    const seller = await interaction.guild.members.fetch(sellerId);

    if (interaction.user.id === sellerId) {
        return interaction.reply({
            content: "You can't vouch for yourself!",
            ephemeral: true
        });
    }

    const modal = new ModalBuilder()
        .setCustomId('vouch_modal')
        .setTitle('Vouch for Seller');

    const starsInput = new TextInputBuilder()
        .setCustomId('stars')
        .setLabel("Star Rating (1-5)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('5')
        .setRequired(true);

    const productInput = new TextInputBuilder()
        .setCustomId('product')
        .setLabel("Product/Service")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('What did you buy?')
        .setRequired(true);

    const messageInput = new TextInputBuilder()
        .setCustomId('message')
        .setLabel("Vouch Message")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder(`Describe your experience (must include ${config.requiredVouchText})`)
        .setRequired(true);

    const firstActionRow = new ActionRowBuilder().addComponents(starsInput);
    const secondActionRow = new ActionRowBuilder().addComponents(productInput);
    const thirdActionRow = new ActionRowBuilder().addComponents(messageInput);

    modal.addComponents(firstActionRow, secondActionRow, thirdActionRow);

    await interaction.showModal(modal);
}

async function handleCloseTicket(interaction) {
    const ticket = await Ticket.findOne({
        channelId: interaction.channel.id,
        closed: false
    });

    if (!ticket) {
        return interaction.reply({
            content: "This is not an active ticket channel.",
            ephemeral: true
        });
    }

    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages) && interaction.user.id !== ticket.userId) {
        return interaction.reply({
            content: "Only staff or the ticket creator can close tickets.",
            ephemeral: true
        });
    }

    ticket.closed = true;
    await ticket.save();

    await interaction.reply({
        content: "Closing this ticket in 5 seconds...",
        ephemeral: false // Public in ticket channel
    });
    setTimeout(async () => {
        await interaction.channel.delete();
    }, 5000);
}

async function handleVouchModal(interaction) {
    const stars = interaction.fields.getTextInputValue('stars');
    const product = interaction.fields.getTextInputValue('product');
    const message = interaction.fields.getTextInputValue('message');

    if (!message.toLowerCase().includes(config.requiredVouchText.toLowerCase())) {
        return interaction.reply({
            content: `Your vouch must include "${config.requiredVouchText}" to be valid.`,
            ephemeral: true
        });
    }

    const starRating = parseInt(stars);
    if (isNaN(starRating) || starRating < 1 || starRating > 5) {
        return interaction.reply({
            content: 'Please enter a valid star rating between 1 and 5.',
            ephemeral: true
        });
    }

    const seller = interaction.message.mentions.users.first();
    let vouchRole = interaction.guild.roles.cache.find(r => r.name === config.vouchRole);

    if (!vouchRole) {
        vouchRole = await interaction.guild.roles.create({
            name: config.vouchRole,
            color: 'GOLD',
            reason: 'Role for vouched sellers'
        });
    }

    const member = await interaction.guild.members.fetch(seller.id);
    if (!member.roles.cache.has(vouchRole.id)) {
        await interaction.reply({
            content: "You need to Vouch a valid seller!",
            ephemeral: true
        })
    }

    // Save vouch to database
    const newVouch = new Vouch({
        sellerId: seller.id,
        voucherId: interaction.user.id,
        guildId: interaction.guild.id,
        stars: starRating,
        product,
        message
    });
    await newVouch.save();
    const starAmount = ':star:'.repeat(starRating) + ':white_small_square:'.repeat(5 - starRating);

    // Create vouch embed (public)
    const embed = new EmbedBuilder()
        .setTitle('New Vouch Received!')
        .setDescription(`${seller} has been vouched by ${interaction.user}`)
        .addFields(
            { name: 'Stars', value: `${starAmount}`, inline: true },
            { name: 'Product', value: product, inline: true },
            { name: 'Message', value: message }
        )
        .setColor(0x00FF00)
        .setTimestamp();

    // Private confirmation
    await interaction.reply({
        content: `Thank you for vouching for ${seller}!`,
        ephemeral: true
    });

    // Public vouch announcement
    await interaction.channel.send({ embeds: [embed] });
    logAction(interaction.guild, `New vouch for ${seller.tag} by ${interaction.user.tag}`);
}

// Helper function to log actions
async function logAction(guild, content) {
    const channel = guild.channels.cache.find(c => c.name === config.logChannel);
    if (channel) {
        await channel.send(content);
    }
}

client.login(process.env.TOKEN);