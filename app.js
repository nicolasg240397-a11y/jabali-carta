document.addEventListener('DOMContentLoaded', () => {
    const navBtns = document.querySelectorAll('.nav-btn');
    const sections = document.querySelectorAll('.menu-section');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all buttons and sections
            navBtns.forEach(b => b.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));

            // Add active class to clicked button
            btn.classList.add('active');

            // Show target section
            const targetId = btn.getAttribute('data-target');
            document.getElementById(targetId).classList.add('active');

            // Re-trigger animation by doing a slight DOM redraw trick 
            const targetSection = document.getElementById(targetId);
            const categories = targetSection.querySelectorAll('.menu-category');
            categories.forEach(cat => {
                cat.style.animation = 'none';
                cat.offsetHeight; /* trigger reflow */
                cat.style.animation = null;
            });
        });
    });
});
