<template>
  <section class="profile-page" data-testid="profile-page">
    <header class="profile-page__header">
      <div>
        <p class="profile-page__eyebrow">{{ t('pageMeta.identityEyebrow') }}</p>
        <h1>{{ t('page.profile') }}</h1>
      </div>
      <v-btn class="profile-page__back" to="/console" variant="text">{{ t('profile.backToConsole') }}</v-btn>
    </header>

    <div v-if="isLoading" class="profile-page__loading" data-testid="profile-page-loading">
      <v-progress-linear indeterminate />
      <div class="profile-page__loading-grid">
        <div class="profile-page__loading-card" />
        <div class="profile-page__loading-card" />
        <div class="profile-page__loading-card" />
      </div>
    </div>

    <div v-else-if="currentUser" class="profile-page__grid">
      <section class="profile-card profile-card--account">
        <div class="profile-card__avatar">{{ avatarText }}</div>
        <div class="profile-card__identity">
          <p class="profile-card__eyebrow">{{ t('profile.accountTitle') }}</p>
          <strong>{{ currentUserName }}</strong>
          <small>{{ currentUser.username }}</small>
          <small>{{ currentUser.group }}</small>
        </div>
      </section>

      <section class="profile-card profile-card--editor">
        <h2>{{ t('profile.nicknameTitle') }}</h2>
        <p>{{ t('profile.nicknameDescription') }}</p>

        <form class="profile-card__form" @submit.prevent="submit">
          <v-text-field
            v-model="draftNickname"
            :error-messages="nicknameError"
            :label="t('profile.nicknameLabel')"
            variant="outlined"
          />

          <Transition name="moe-overlay">
            <v-alert v-if="saveErrorVisible" type="error" variant="tonal">{{ saveErrorMessage }}</v-alert>
          </Transition>
          <Transition name="moe-overlay">
            <v-alert v-if="saveSuccessVisible" type="success" variant="tonal">{{ t('profile.saveSuccess') }}</v-alert>
          </Transition>

          <div class="profile-card__actions">
            <v-btn color="primary" :loading="updateProfileMutation.isPending.value" type="submit">{{ t('profile.saveNickname') }}</v-btn>
          </div>
        </form>
      </section>

      <section class="profile-card profile-card--preferences">
        <h2>{{ t('profile.preferencesTitle') }}</h2>
        <p>{{ t('profile.preferencesDescription') }}</p>
        <PreferenceSwitcher density="compact" placement="inline" />
      </section>

      <section class="profile-card profile-card--links">
        <h2>{{ t('profile.quickLinksTitle') }}</h2>
        <div class="profile-card__links">
          <v-btn to="/console" variant="tonal">{{ t('page.overview') }}</v-btn>
          <v-btn to="/link" variant="tonal">{{ t('page.links') }}</v-btn>
          <v-btn to="/analytics" variant="tonal">{{ t('page.analytics') }}</v-btn>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import { me } from '@/entities/auth/api'
import { updateProfile } from '@/entities/user/api'
import PreferenceSwitcher from '@/shared/preferences/PreferenceSwitcher.vue'
import { useAvatarText } from '@/shared/user/useAvatarText'

const { t } = useI18n()
const queryClient = useQueryClient()
const currentUserQuery = useQuery({
  queryKey: ['auth', 'me'],
  queryFn: me,
})
const currentUser = computed(() => currentUserQuery.data.value?.user)
const currentUserName = computed(() => currentUser.value?.nickname || currentUser.value?.username || 'guest')
const avatarText = useAvatarText(currentUserName)
const draftNickname = ref('')
const nicknameError = ref('')
const saveErrorVisible = ref(false)
const saveSuccessVisible = ref(false)
const saveErrorMessage = computed(() => t('profile.saveFailed'))
const isLoading = computed(() => currentUserQuery.isPending.value || !currentUser.value)

watch(
  currentUser,
  (user) => {
    if (user) {
      draftNickname.value = user.nickname
    }
  },
  { immediate: true },
)

const updateProfileMutation = useMutation({
  mutationFn: updateProfile,
  onSuccess(result) {
    const user = result.user
    saveErrorVisible.value = false
    saveSuccessVisible.value = true
    nicknameError.value = ''
    draftNickname.value = user.nickname
    queryClient.setQueryData(['auth', 'me'], { user })
    void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
  },
  onError() {
    saveSuccessVisible.value = false
    saveErrorVisible.value = true
  },
})

function submit() {
  const nickname = draftNickname.value.trim()
  if (!nickname) {
    nicknameError.value = t('profile.nicknameRequired')
    saveSuccessVisible.value = false
    saveErrorVisible.value = false
    return
  }

  nicknameError.value = ''
  saveErrorVisible.value = false
  saveSuccessVisible.value = false
  updateProfileMutation.mutate({ nickname })
}
</script>

<style scoped>
.profile-page {
  display: grid;
  gap: 18px;
}

.profile-page__header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
}

.profile-page__eyebrow {
  margin: 0 0 6px;
  color: rgb(var(--v-theme-primary));
  font-size: 0.84rem;
  font-weight: 820;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.profile-page__header h1 {
  margin: 0;
  font-size: clamp(1.8rem, 4vw, 2.5rem);
  line-height: 1.1;
}

.profile-page__back {
  flex: 0 0 auto;
}

.profile-page__loading {
  display: grid;
  gap: 16px;
}

.profile-page__loading-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.profile-page__loading-card {
  min-height: 150px;
  border-radius: 26px;
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 78%, var(--moeurl-surface-soft) 22%);
}

.profile-page__grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.profile-card {
  display: grid;
  gap: 14px;
  padding: 22px;
  border: 1px solid var(--moeurl-outline);
  border-radius: 28px;
  background: var(--moeurl-surface-elevated);
  box-shadow: var(--moeurl-shadow);
}

.profile-card--account {
  align-items: center;
  grid-template-columns: auto minmax(0, 1fr);
}

.profile-card__avatar {
  display: inline-grid;
  width: 72px;
  height: 72px;
  place-items: center;
  border-radius: 28px;
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 16%, transparent);
  color: rgb(var(--v-theme-primary));
  font-size: 1.5rem;
  font-weight: 900;
}

.profile-card__identity {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.profile-card__eyebrow {
  margin: 0;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.82rem;
  font-weight: 760;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.profile-card__identity strong {
  font-size: 1.28rem;
}

.profile-card__identity small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgb(var(--v-theme-on-surface-variant));
}

.profile-card--editor,
.profile-card--preferences,
.profile-card--links {
  min-height: 100%;
}

.profile-card--editor h2,
.profile-card--preferences h2,
.profile-card--links h2 {
  margin: 0;
  font-size: 1.18rem;
}

.profile-card__form {
  display: grid;
  gap: 12px;
}

.profile-card__actions {
  display: flex;
  justify-content: flex-start;
}

.profile-card__links {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

@media (max-width: 900px) {
  .profile-page__grid {
    grid-template-columns: 1fr;
  }

  .profile-page__loading-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 620px) {
  .profile-page__header {
    align-items: start;
    flex-direction: column;
  }

  .profile-card {
    padding: 18px;
    border-radius: 24px;
  }

  .profile-card--account {
    grid-template-columns: 1fr;
  }
}
</style>
