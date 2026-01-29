import logging

logger = logging.getLogger(__name__)


class ConfigMixin:
    async def get_model_config(self):
        """Get the current model configuration"""
        async with self._get_connection() as conn:
            cursor = await conn.execute("SELECT provider, model, whisperModel FROM settings")
            row = await cursor.fetchone()
            return dict(zip([col[0] for col in cursor.description], row)) if row else None

    async def save_model_config(self, provider: str, model: str, whisperModel: str):
        """Save the model configuration"""
        # Input validation
        if not provider or not provider.strip():
            raise ValueError("Provider cannot be empty")
        if not model or not model.strip():
            raise ValueError("Model cannot be empty")
        if not whisperModel or not whisperModel.strip():
            raise ValueError("Whisper model cannot be empty")

        try:
            async with self._get_connection() as conn:
                await conn.execute("BEGIN TRANSACTION")

                try:
                    # Check if the configuration already exists
                    cursor = await conn.execute("SELECT id FROM settings")
                    existing_config = await cursor.fetchone()
                    if existing_config:
                        # Update existing configuration
                        await conn.execute("""
                            UPDATE settings
                            SET provider = ?, model = ?, whisperModel = ?
                            WHERE id = '1'
                        """, (provider, model, whisperModel))
                    else:
                        # Insert new configuration
                        await conn.execute("""
                            INSERT INTO settings (id, provider, model, whisperModel)
                            VALUES (?, ?, ?, ?)
                        """, ('1', provider, model, whisperModel))

                    await conn.commit()
                    logger.info(f"Successfully saved model configuration: {provider}/{model}")

                except Exception as e:
                    await conn.rollback()
                    logger.error(f"Failed to save model configuration: {str(e)}", exc_info=True)
                    raise

        except Exception as e:
            logger.error(f"Database connection error in save_model_config: {str(e)}", exc_info=True)
            raise


    async def save_api_key(self, api_key: str, provider: str):
        """Save the API key"""
        provider_list = ["openai", "claude", "groq", "ollama"]
        if provider not in provider_list:
            raise ValueError(f"Invalid provider: {provider}")
        if provider == "openai":
            api_key_name = "openaiApiKey"
        elif provider == "claude":
            api_key_name = "anthropicApiKey"
        elif provider == "groq":
            api_key_name = "groqApiKey"
        elif provider == "ollama":
            api_key_name = "ollamaApiKey"

        try:
            async with self._get_connection() as conn:
                await conn.execute("BEGIN TRANSACTION")

                try:
                    # Check if settings row exists
                    cursor = await conn.execute("SELECT id FROM settings WHERE id = '1'")
                    existing_config = await cursor.fetchone()

                    if existing_config:
                        # Update existing configuration
                        await conn.execute(f"UPDATE settings SET {api_key_name} = ? WHERE id = '1'", (api_key,))
                    else:
                        # Insert new configuration with default values and the API key
                        await conn.execute(f"""
                            INSERT INTO settings (id, provider, model, whisperModel, {api_key_name})
                            VALUES (?, ?, ?, ?, ?)
                        """, ('1', 'openai', 'gpt-4o-2024-11-20', 'large-v3', api_key))

                    await conn.commit()
                    logger.info(f"Successfully saved API key for provider: {provider}")

                except Exception as e:
                    await conn.rollback()
                    logger.error(f"Failed to save API key for provider {provider}: {str(e)}", exc_info=True)
                    raise

        except Exception as e:
            logger.error(f"Database connection error in save_api_key: {str(e)}", exc_info=True)
            raise

    async def get_api_key(self, provider: str):
        """Get the API key"""
        provider_list = ["openai", "claude", "groq", "ollama"]
        if provider not in provider_list:
            raise ValueError(f"Invalid provider: {provider}")
        if provider == "openai":
            api_key_name = "openaiApiKey"
        elif provider == "claude":
            api_key_name = "anthropicApiKey"
        elif provider == "groq":
            api_key_name = "groqApiKey"
        elif provider == "ollama":
            api_key_name = "ollamaApiKey"
        async with self._get_connection() as conn:
            cursor = await conn.execute(f"SELECT {api_key_name} FROM settings WHERE id = '1'")
            row = await cursor.fetchone()
            return row[0] if row and row[0] else ""

    async def delete_api_key(self, provider: str):
        """Delete the API key"""
        provider_list = ["openai", "claude", "groq", "ollama"]
        if provider not in provider_list:
            raise ValueError(f"Invalid provider: {provider}")
        if provider == "openai":
            api_key_name = "openaiApiKey"
        elif provider == "claude":
            api_key_name = "anthropicApiKey"
        elif provider == "groq":
            api_key_name = "groqApiKey"
        elif provider == "ollama":
            api_key_name = "ollamaApiKey"
        async with self._get_connection() as conn:
            await conn.execute(f"UPDATE settings SET {api_key_name} = NULL WHERE id = '1'")
            await conn.commit()

    async def get_transcript_config(self):
        """Get the current transcript configuration"""
        async with self._get_connection() as conn:
            cursor = await conn.execute("SELECT provider, model FROM transcript_settings")
            row = await cursor.fetchone()
            if row:
                return dict(zip([col[0] for col in cursor.description], row))
            else:
                # Return default configuration if no transcript settings exist
                return {
                    "provider": "localWhisper",
                    "model": "large-v3"
                }

    async def save_transcript_config(self, provider: str, model: str):
        """Save the transcript settings"""
        # Input validation
        if not provider or not provider.strip():
            raise ValueError("Provider cannot be empty")
        if not model or not model.strip():
            raise ValueError("Model cannot be empty")

        try:
            async with self._get_connection() as conn:
                await conn.execute("BEGIN TRANSACTION")

                try:
                    # Check if the configuration already exists
                    cursor = await conn.execute("SELECT id FROM transcript_settings")
                    existing_config = await cursor.fetchone()
                    if existing_config:
                        # Update existing configuration
                        await conn.execute("""
                            UPDATE transcript_settings
                            SET provider = ?, model = ?
                            WHERE id = '1'
                        """, (provider, model))
                    else:
                        # Insert new configuration
                        await conn.execute("""
                            INSERT INTO transcript_settings (id, provider, model)
                            VALUES (?, ?, ?)
                        """, ('1', provider, model))

                    await conn.commit()
                    logger.info(f"Successfully saved transcript configuration: {provider}/{model}")

                except Exception as e:
                    await conn.rollback()
                    logger.error(f"Failed to save transcript configuration: {str(e)}", exc_info=True)
                    raise

        except Exception as e:
            logger.error(f"Database connection error in save_transcript_config: {str(e)}", exc_info=True)
            raise

    async def save_transcript_api_key(self, api_key: str, provider: str):
        """Save the transcript API key"""
        provider_list = ["localWhisper","deepgram","elevenLabs","groq","openai"]
        if provider not in provider_list:
            raise ValueError(f"Invalid provider: {provider}")
        if provider == "localWhisper":
            api_key_name = "whisperApiKey"
        elif provider == "deepgram":
            api_key_name = "deepgramApiKey"
        elif provider == "elevenLabs":
            api_key_name = "elevenLabsApiKey"
        elif provider == "groq":
            api_key_name = "groqApiKey"
        elif provider == "openai":
            api_key_name = "openaiApiKey"

        try:
            async with self._get_connection() as conn:
                await conn.execute("BEGIN TRANSACTION")

                try:
                    # Check if transcript settings row exists
                    cursor = await conn.execute("SELECT id FROM transcript_settings WHERE id = '1'")
                    existing_config = await cursor.fetchone()

                    if existing_config:
                        # Update existing configuration
                        await conn.execute(f"UPDATE transcript_settings SET {api_key_name} = ? WHERE id = '1'", (api_key,))
                    else:
                        # Insert new configuration with default values and the API key
                        await conn.execute(f"""
                            INSERT INTO transcript_settings (id, provider, model, {api_key_name})
                            VALUES (?, ?, ?, ?)
                        """, ('1', 'localWhisper', 'large-v3', api_key))

                    await conn.commit()
                    logger.info(f"Successfully saved transcript API key for provider: {provider}")

                except Exception as e:
                    await conn.rollback()
                    logger.error(f"Failed to save transcript API key for provider {provider}: {str(e)}", exc_info=True)
                    raise

        except Exception as e:
            logger.error(f"Database connection error in save_transcript_api_key: {str(e)}", exc_info=True)
            raise


    async def get_transcript_api_key(self, provider: str):
        """Get the transcript API key"""
        provider_list = ["localWhisper","deepgram","elevenLabs","groq","openai"]
        if provider not in provider_list:
            raise ValueError(f"Invalid provider: {provider}")
        if provider == "localWhisper":
            api_key_name = "whisperApiKey"
        elif provider == "deepgram":
            api_key_name = "deepgramApiKey"
        elif provider == "elevenLabs":
            api_key_name = "elevenLabsApiKey"
        elif provider == "groq":
            api_key_name = "groqApiKey"
        elif provider == "openai":
            api_key_name = "openaiApiKey"
        async with self._get_connection() as conn:
            cursor = await conn.execute(f"SELECT {api_key_name} FROM transcript_settings WHERE id = '1'")
            row = await cursor.fetchone()
            return row[0] if row and row[0] else ""
