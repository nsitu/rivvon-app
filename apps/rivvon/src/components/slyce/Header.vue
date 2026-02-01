<template>
    <!-- Header -->
    <div class="header-container">
        <div class="header-row">
            <div class="header-brand">
                <span class="cascadia slyce">
                    slyce
                </span>

                <div class="separator"></div>
                <span class="cascadia tagline">Texture Creator for</span>

                <a
                    href="https://rivvon.ca"
                    class="rivvon-link"
                ><img
                        class="rivvon-logo"
                        src="/rivvon-black.svg"
                    /></a>

            </div>
            <AuthButton />
        </div>
    </div>
</template>

<script setup>
    import AuthButton from './AuthButton.vue'
</script>

<style scoped>
    .header-container {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 0.75rem;
        width: 100%;
    }

    @media (min-width: 640px) {
        .header-container {
            flex-direction: row;
            flex-wrap: nowrap;
            gap: 0.75rem;
            padding: 1rem;
        }
    }

    .header-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
        justify-content: space-between;
        width: 100%;
    }

    @media (min-width: 640px) {
        .header-row {
            flex-wrap: nowrap;
            gap: 1rem;
        }
    }

    .header-brand {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    @media (min-width: 640px) {
        .header-brand {
            gap: 0.75rem;
            margin-left: 1.25rem;
        }
    }

    .separator {
        display: none;
        width: 3px;
        height: 3rem;
        background: var(--bg-muted-alt);
        padding: 0px;
        margin: 0 1rem;
    }

    @media (min-width: 768px) {
        .separator {
            display: block;
            height: 4rem;
            margin: 0 2rem;
        }
    }

    .tagline {
        display: none;
    }

    @media (min-width: 768px) {
        .tagline {
            display: inline;
        }
    }

    .rivvon-link {
        display: none;
    }

    @media (min-width: 768px) {
        .rivvon-link {
            display: inline;
        }
    }

    .rivvon-logo {
        width: 9rem;
    }

    svg {
        width: 8rem;
    }

    svg path {
        fill: #434242;
    }
</style>