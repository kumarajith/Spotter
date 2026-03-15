import {
  APIChatInputApplicationCommandInteraction,
  InteractionResponseType,
  MessageFlags,
} from 'discord-api-types/v10';

export function autocompleteResult(choices: { name: string; value: string }[]): {
  type: InteractionResponseType.ApplicationCommandAutocompleteResult;
  data: { choices: { name: string; value: string }[] };
} {
  return {
    type: InteractionResponseType.ApplicationCommandAutocompleteResult,
    data: { choices },
  };
}

export function ephemeral(content: string) {
  return {
    type: InteractionResponseType.ChannelMessageWithSource,
    data: { content, flags: MessageFlags.Ephemeral },
  };
}

export function getStringOption(
  options: APIChatInputApplicationCommandInteraction['data']['options'],
  name: string,
): string | undefined {
  return (options?.find((o) => o.name === name) as { value?: string } | undefined)?.value;
}
