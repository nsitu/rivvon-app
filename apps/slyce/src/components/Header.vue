<template>
    <!-- Header -->
    <div class="flex gap-3 items-center justify-between p-4 w-full">
        <div class="flex gap-3 items-center">

            <span class="cascadia slyce ml-5">
                slyce
                <!-- <span>f</span>
                <span style="margin-left: -0.1rem;">l</span>
                <span style="margin-left: -0.1rem;">o</span> -->
            </span>

            <div class="separator"></div>
            <span class="cascadia tagline">Texture Creator for</span>


            <a href="https://rivvon.ca"><img
                    style="width: 9rem;"
                    src="/rivvon-black.svg"
                /></a>

        </div>
        <AuthButton />
    </div>
</template>

<script setup>
    import AuthButton from './AuthButton.vue'
</script>

<style scoped>


    .separator {
        width: 3px;
        height: 4rem;
        background: #ddd;
        padding: 0px;
        margin: 0 2rem;
    }

    svg {
        width: 8rem;
    }

    svg path {
        fill: #434242;
    }
</style>